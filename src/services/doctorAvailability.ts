// services/doctorAvailability.ts
//
// Server-side mirror of the slot-generation logic BookAppointmentScreen.tsx
// (mobile) already uses client-side to build the pickable time-slot list —
// kept in lockstep with it so "next available" shown on a doctor card always
// means the same thing as what the booking screen would actually offer.
import { Appointment } from "../models/appointment";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Matches the exact status set the unique "one active booking per slot"
// index and getBookedSlots both already use — a slot is only actually
// unavailable if a live (non-cancelled/rejected/expired) appointment holds it.
const LIVE_STATUSES_EXCLUDED = ["cancelled", "rejected", "expired"];

const DEFAULT_HORIZON_DAYS = 14;

interface DaySlot {
  available?: boolean;
  from?: string;
  to?: string;
}

function getDaySlot(date: Date, availability: Record<string, any> | undefined): DaySlot | null {
  if (!availability) return null;
  const day = availability[WEEKDAY_NAMES[date.getDay()]];
  // Two different save conventions exist across the two clients: mobile's
  // editor always writes all 7 days with an explicit `available` boolean
  // (leaving stale from/to on a day toggled off); web's editor omits a
  // disabled day from the object entirely, never writing `available` at
  // all. So "unavailable" is `available === false` specifically — not
  // "falsy" — otherwise a day web considers open (from/to present,
  // `available` simply never set) would be wrongly treated as closed.
  if (day?.available === false || !day?.from || !day?.to) return null;
  return day;
}

function generateTimeSlots(from: string, to: string, slotMin: number): string[] {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const start = fh * 60 + fm;
  const end = th * 60 + tm;
  const slots: string[] = [];
  for (let t = start; t < end; t += slotMin) {
    slots.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return slots;
}

function slotToDate(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Finds the earliest open slot for a SINGLE doctor, given their availability
 * schedule and a pre-fetched list of that doctor's live (not
 * cancelled/rejected/expired) appointments. Looks up to `horizonDays` ahead;
 * returns null if nothing opens up in that window.
 */
function findNextAvailableSlot(
  availability: Record<string, any> | undefined,
  bookedAppointments: { scheduledAt: Date; duration?: number }[],
  now: Date,
  horizonDays: number
): Date | null {
  if (!availability) return null;
  const slotDuration = availability.slotDuration ?? 30;

  for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);
    date.setHours(0, 0, 0, 0);

    const day = getDaySlot(date, availability);
    if (!day || !day.from || !day.to) continue;

    const candidates = generateTimeSlots(day.from, day.to, slotDuration);
    for (const hhmm of candidates) {
      const slotStart = slotToDate(date, hhmm);
      if (slotStart <= now) continue; // already past — not bookable

      const taken = bookedAppointments.some((b) => {
        const bStart = new Date(b.scheduledAt).getTime();
        const bEnd = bStart + (b.duration || 30) * 60000;
        return slotStart.getTime() >= bStart && slotStart.getTime() < bEnd;
      });
      if (!taken) return slotStart;
    }
  }

  return null;
}

/**
 * Server-side guard for POST /appointments — createAppointment previously
 * did zero validation against the doctor's availability schedule, trusting
 * the client's own slot picker entirely. Since that client-side generator
 * has its own bug (ignoring `available: false`, fixed alongside this), nothing
 * stopped an appointment being booked on a day/time the doctor never
 * actually opened up. Checks the requested time lands exactly on one of the
 * doctor's generated slot boundaries for that day.
 */
export function isSlotWithinAvailability(
  availability: Record<string, any> | undefined,
  scheduledAt: Date
): boolean {
  const day = getDaySlot(scheduledAt, availability);
  if (!day || !day.from || !day.to) return false;

  const slotDuration = availability?.slotDuration ?? 30;
  const candidates = generateTimeSlots(day.from, day.to, slotDuration);
  const hhmm = `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`;
  return candidates.includes(hhmm);
}

/**
 * Batch version for a doctor list/browse page — one Appointment query for
 * every doctor in the list instead of one per doctor, so rendering a page of
 * doctor cards doesn't fan out into dozens of DB round-trips.
 */
export async function computeNextAvailableSlots(
  doctors: { _id: any; availability?: Record<string, any> }[],
  horizonDays: number = DEFAULT_HORIZON_DAYS
): Promise<Map<string, Date | null>> {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + horizonDays + 1);
  horizon.setHours(0, 0, 0, 0);

  const doctorIds = doctors.map((d) => d._id);
  const appointments = await Appointment.find({
    doctorId: { $in: doctorIds },
    scheduledAt: { $gte: now, $lt: horizon },
    status: { $nin: LIVE_STATUSES_EXCLUDED },
  })
    .select("doctorId scheduledAt duration")
    .lean();

  const byDoctor = new Map<string, { scheduledAt: Date; duration?: number }[]>();
  for (const appt of appointments) {
    const key = String(appt.doctorId);
    if (!byDoctor.has(key)) byDoctor.set(key, []);
    byDoctor.get(key)!.push({ scheduledAt: appt.scheduledAt, duration: appt.duration });
  }

  const result = new Map<string, Date | null>();
  for (const doctor of doctors) {
    const key = String(doctor._id);
    result.set(
      key,
      findNextAvailableSlot(doctor.availability, byDoctor.get(key) ?? [], now, horizonDays)
    );
  }
  return result;
}
