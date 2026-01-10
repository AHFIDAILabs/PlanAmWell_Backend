import { Types } from "mongoose";
import { User } from "../models/user";
import Notification from "../models/notifications";
import { emitNotification } from "../index";
import { sendPushNotification } from "./sendPushNotification";
import { Admin } from "../models/admin";

interface CommentAuthor {
  name?: string;
  email?: string;
  userId?: string; // ✅ Changed to string
}

interface CommentData {
  _id: string; // ✅ Changed to string only
  content: string;
  author?: CommentAuthor;
}

/**
 * 🚩 Notify all admins about a flagged comment
 */
export async function notifyAdmins(
  commentId: string,
  reason: string,
  comment: CommentData
) {
  try {
    // Find all admin users
    const admins = await Admin.find({ roles: "Admin" })
  .select("_id")
  .lean<{ _id: Types.ObjectId }[]>();


    if (!admins.length) {
      console.warn("⚠️ No admins found to notify about flagged comment");
      return;
    }

    console.log(`🚩 Notifying ${admins.length} admin(s) about flagged comment: ${commentId}`);

    // Create notifications for each admin
    const notificationDocs = admins.map((admin) => ({
      userId: new Types.ObjectId(admin._id),
      userType: "Admin" as const,
      type: "system" as const,
      title: "Comment Flagged for Review",
      message: `A comment has been flagged. Reason: ${reason}`,
      isRead: false,
      metadata: {
        commentId,
        reason,
        authorId: comment.author?.userId, // ✅ Already a string now
        authorUsername: comment.author?.name,
        contentPreview: comment.content.substring(0, 100),
      },
    }));

    const notifications = await Notification.insertMany(notificationDocs);

    // Send real-time notifications to connected admins
    for (let i = 0; i < admins.length; i++) {
      const admin = admins[i];
      const notification = notifications[i];

      // Emit socket notification
      const notificationObject = {
        _id: notification._id.toString(),
        userId: admin._id.toString(),
        userType: notification.userType,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        metadata: notification.metadata,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
      };

      emitNotification(admin._id.toString(), notificationObject);

      // Send push notification (non-blocking)
      sendPushNotification(admin._id.toString(), notification as any).catch(
        console.error
      );
    }

    console.log(`✅ Successfully notified ${admins.length} admin(s)`);
  } catch (error) {
    console.error("❌ Failed to notify admins:", error);
    throw error;
  }
}