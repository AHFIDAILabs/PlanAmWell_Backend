// models/comment.ts
import mongoose, { Schema, Document, Types } from "mongoose";

export interface IComment extends Document {
  articleId: Types.ObjectId;
  userId?: Types.ObjectId;
  author: {
    name: string;
    email?: string;
    userId?: Types.ObjectId;
  };
  content: string;
  parentCommentId?: Types.ObjectId; // For replies
  status: "pending" | "approved" | "rejected" | "flagged";
  flagReason?: string;
  likes: number;
  likedBy: Types.ObjectId[]; // Track who liked
  isEdited: boolean;
  editedAt?: Date;
  replies: Types.ObjectId[]; // Reference to child comments
  depth: number; // 0 for top-level, 1 for first reply, etc.
    createdAt: Date;
  updatedAt: Date;
}

const CommentSchema = new Schema<IComment>(
  {
    articleId: {
      type: Schema.Types.ObjectId,
      ref: "AdvocacyArticle",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    author: {
      name: {
        type: String,
        required: [true, "Author name is required"],
        trim: true,
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
      },
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    },
    content: {
      type: String,
      required: [true, "Comment content is required"],
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
      trim: true,
    },
    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "flagged"],
      default: "approved", // Auto-approve for registered users, can be changed
      index: true,
    },
    flagReason: {
  type: String,
  trim: true,
  default: null,
},
    likes: {
      type: Number,
      default: 0,
    },
    likedBy: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    replies: [
      {
        type: Schema.Types.ObjectId,
        ref: "Comment",
      },
    ],
    depth: {
      type: Number,
      default: 0,
      max: 3, // Limit nesting to 3 levels
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for efficient queries
CommentSchema.index({ articleId: 1, status: 1, createdAt: -1 });
CommentSchema.index({ parentCommentId: 1, createdAt: 1 });
CommentSchema.index({ userId: 1 });

// Virtual for reply count
CommentSchema.virtual("replyCount").get(function () {
  return this.replies?.length || 0;
});

// Middleware to update parent comment's replies array
CommentSchema.post("save", async function () {
  if (this.parentCommentId) {
    await mongoose.model("Comment").findByIdAndUpdate(
      this.parentCommentId,
      {
        $addToSet: { replies: this._id },
      }
    );
  }
});

// Middleware to remove from parent's replies array on delete
CommentSchema.post("findOneAndDelete", async function (doc) {
  if (doc && doc.parentCommentId) {
    await mongoose.model("Comment").findByIdAndUpdate(
      doc.parentCommentId,
      {
        $pull: { replies: doc._id },
      }
    );
  }

  // Delete all child replies recursively
  if (doc && doc.replies && doc.replies.length > 0) {
    await mongoose.model("Comment").deleteMany({
      _id: { $in: doc.replies },
    });
  }
});

export const Comment = mongoose.model<IComment>("Comment", CommentSchema);