// services/doctorStats.ts
//
// Computed fresh at read time rather than a maintained counter field — a
// counter would need updating from every place an appointment's status
// transitions to "completed", and drifting out of sync silently is a worse
// failure mode for a number displayed to patients than one extra aggregate
// query on a doctor list that's already small enough to batch cheaply.
import { Appointment } from "../models/appointment";

/**
 * Batch: distinct patients (completed appointments) per doctor, in one query
 * instead of one per doctor.
 */
export async function computePatientCounts(doctorIds: any[]): Promise<Map<string, number>> {
  const rows = await Appointment.aggregate([
    { $match: { doctorId: { $in: doctorIds }, status: "completed" } },
    { $group: { _id: { doctorId: "$doctorId", userId: "$userId" } } },
    { $group: { _id: "$_id.doctorId", count: { $sum: 1 } } },
  ]);

  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(String(row._id), row.count);
  }
  return result;
}
