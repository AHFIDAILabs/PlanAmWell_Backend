import { Request, Response } from "express";
import { Doctor, IDoctor } from "../models/doctor";
import asyncHandler from "../middleware/asyncHandler";
import { Admin, GrowthData } from "../models/admin";
import { User } from "../models/user";
import { signJwt } from "../middleware/auth";

// ------------------- Admin Registration -------------------
export const registerAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { firstName, lastName, email, password } = req.body;

  const existing = await Admin.findOne({ email });
  if (existing) return res.status(400).json({ message: "Admin already exists" });

  const admin = await Admin.create({ firstName, lastName, email, password });
  const token = signJwt(admin);

  res.status(201).json({ success: true, data: { admin, token } });
});

// ------------------- Admin Login -------------------
export const loginAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const admin = await Admin.findOne({ email });
  if (!admin || !(await admin.comparePassword(password))) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = signJwt(admin);
  res.status(200).json({ success: true, data: { admin, token } });
});

// ------------------- Get All Admins -------------------
export const getAllAdmins = asyncHandler(async (_req: Request, res: Response) => {
  const admins = await Admin.find().select("-password");
  res.status(200).json({ success: true, data: admins });
});

// ------------------- Get All Doctors (Admin) -------------------
export const getAllDoctorsAdmin = asyncHandler(async (_req: Request, res: Response) => {
  const doctors: IDoctor[] = await Doctor.find({}).select("-passwordHash");
  res.status(200).json({ success: true, data: doctors });
});

// ------------------- Get Pending Doctors Only -------------------
export const getPendingDoctorsAdmin = asyncHandler(async (_req: Request, res: Response) => {
  const doctors: IDoctor[] = await Doctor.find({ status: "submitted" }).select("-passwordHash");
  res.status(200).json({ success: true, data: doctors });
});

// ------------------- Update Doctor Status -------------------
export const updateDoctorStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.body;
  const doctorId = req.params.doctorId;


  if (!status || !["submitted", "reviewing", "approved", "rejected"].includes(status)) {
    res.status(400);
    throw new Error("Invalid or missing 'status' field.");
  }

  const doctor: IDoctor | null = await Doctor.findById(doctorId);
  if (!doctor) {
    res.status(404);
    throw new Error("Doctor not found");
  }

  // Prevent downgrade from approved except to rejected
  if (doctor.status === "approved" && status !== "approved" && status !== "rejected") {
    res.status(400);
    throw new Error(`Cannot change status from 'approved' to '${status}'.`);
  }

  const updatedDoctor = await Doctor.findByIdAndUpdate(
    doctorId,
    { status },
    { new: true, runValidators: true }
  ).select("-passwordHash");

  res.status(200).json({
    success: true,
    data: updatedDoctor,
    message: `Doctor status updated to '${status}' successfully.`,
  });
});


// ------------------- Get All Users (Admin) -------------------
export const getAllUsersAdmin = asyncHandler(async (_req: Request, res: Response) => {
  const users = await User.find().select("-password").select("-password").populate("userImage"); // exclude passwords
  res.status(200).json({ success: true, data: users });
});


export const getUserByIdAdmin = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId; // Get userId from URL

  if (!userId) {
    res.status(400);
    throw new Error("User ID is required");
  }

  const user = await User.findById(userId)
    .select("-password") // Exclude password
    .populate("userImage"); // Populate avatar/image if stored as reference

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json({
    success: true,
    data: user,
  });
});


/**
 * GET /api/user-growth
 * Query params:
 *   - months (number): how many past months to include, default = 1
 */
export const getCombinedGrowth = async (req: Request, res: Response) => {
  try {
    const months = parseInt(req.query.months as string) || 1;
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

    // Fetch all users and doctors created since startDate
    const [users, doctors] = await Promise.all([
      User.find({ createdAt: { $gte: startDate } }),
      Doctor.find({ createdAt: { $gte: startDate } }),
    ]);

    // --- Monthly aggregation ---
    const monthlyGrowth: GrowthData[] = [];
    for (let i = 0; i < months; i++) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const userCount = users.filter(
        u => new Date(u.createdAt) >= month && new Date(u.createdAt) < nextMonth
      ).length;

      const approvedDoctorCount = doctors.filter(
        d =>
          d.status === "approved" &&
          new Date(d.createdAt) >= month &&
          new Date(d.createdAt) < nextMonth
      ).length;

      const pendingDoctorCount = doctors.filter(
        d =>
          (d.status === "submitted" || d.status === "reviewing") &&
          new Date(d.createdAt) >= month &&
          new Date(d.createdAt) < nextMonth
      ).length;

      monthlyGrowth.unshift({
        label: month.toLocaleString("default", { month: "short", year: "numeric" }),
        users: userCount,
        approvedDoctors: approvedDoctorCount,
        pendingDoctors: pendingDoctorCount,
      });
    }

    // --- Weekly aggregation for current month ---
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const currentMonthUsers = users.filter(u => new Date(u.createdAt) >= currentMonthStart);
    const currentMonthApprovedDoctors = doctors.filter(
      d => d.status === "approved" && new Date(d.createdAt) >= currentMonthStart
    );
    const currentMonthPendingDoctors = doctors.filter(
      d =>
        (d.status === "submitted" || d.status === "reviewing") &&
        new Date(d.createdAt) >= currentMonthStart
    );

    const weeksInMonth = 5;
    const weeklyGrowth: GrowthData[] = [];

    for (let i = 1; i <= weeksInMonth; i++) {
      const userCount = currentMonthUsers.filter(
        u => Math.ceil(new Date(u.createdAt).getDate() / 7) === i
      ).length;

      const approvedDoctorCount = currentMonthApprovedDoctors.filter(
        d => Math.ceil(new Date(d.createdAt).getDate() / 7) === i
      ).length;

      const pendingDoctorCount = currentMonthPendingDoctors.filter(
        d => Math.ceil(new Date(d.createdAt).getDate() / 7) === i
      ).length;

      weeklyGrowth.push({
        label: `Week ${i}`,
        users: userCount,
        approvedDoctors: approvedDoctorCount,
        pendingDoctors: pendingDoctorCount,
      });
    }

    // --- Additional metrics ---
    const totalUsers = await User.countDocuments({});
    const totalApprovedDoctors = await Doctor.countDocuments({ status: "approved" });
    const totalPendingDoctors = await Doctor.countDocuments({
      status: { $in: ["submitted", "reviewing"] },
    });

    const lastMonthUsers = monthlyGrowth[monthlyGrowth.length - 2]?.users || 0;
    const currentMonthUsersCount = monthlyGrowth[monthlyGrowth.length - 1]?.users || 0;
    const userGrowthPercentage = lastMonthUsers
      ? (((currentMonthUsersCount - lastMonthUsers) / lastMonthUsers) * 100).toFixed(2)
      : "100";

    const lastMonthDoctors = monthlyGrowth[monthlyGrowth.length - 2]?.approvedDoctors || 0;
    const currentMonthDoctorsCount = monthlyGrowth[monthlyGrowth.length - 1]?.approvedDoctors || 0;
    const doctorGrowthPercentage = lastMonthDoctors
      ? (((currentMonthDoctorsCount - lastMonthDoctors) / lastMonthDoctors) * 100).toFixed(2)
      : "100";

    const lastMonthPending =
      monthlyGrowth[monthlyGrowth.length - 2]?.pendingDoctors || 0;
    const currentMonthPending =
      monthlyGrowth[monthlyGrowth.length - 1]?.pendingDoctors || 0;
    const pendingGrowthPercentage = lastMonthPending
      ? (((currentMonthPending - lastMonthPending) / lastMonthPending) * 100).toFixed(2)
      : "100";

    const averageWeeklyUserGrowth =
      weeklyGrowth.reduce((acc, w) => acc + w.users, 0) / weeksInMonth;
    const averageWeeklyApprovedDoctorGrowth =
      weeklyGrowth.reduce((acc, w) => acc + w.approvedDoctors!, 0) / weeksInMonth;
    const averageWeeklyPendingDoctorGrowth =
      weeklyGrowth.reduce((acc, w) => acc + w.pendingDoctors!, 0) / weeksInMonth;

    res.status(200).json({
      totalUsers,
      totalApprovedDoctors,
      totalPendingDoctors,
      userGrowthPercentage,
      doctorGrowthPercentage,
      pendingGrowthPercentage,
      averageWeeklyUserGrowth: +averageWeeklyUserGrowth.toFixed(2),
      averageWeeklyApprovedDoctorGrowth: +averageWeeklyApprovedDoctorGrowth.toFixed(2),
      averageWeeklyPendingDoctorGrowth: +averageWeeklyPendingDoctorGrowth.toFixed(2),
      monthlyGrowth,
      weeklyGrowth,
    });
  } catch (err) {
    console.error("Error fetching combined growth:", err);
    res.status(500).json({ message: "Failed to fetch combined growth" });
  }
};

