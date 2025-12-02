import mongoose, { Schema, Document, Types } from "mongoose";

// The interface defines the shape of the document, extending Mongoose's base Document type.
export interface IAdvocacyArticle extends Document {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  category: "all" | "educational" | "success-story" | "policy-brief" | "community-resource";
  tags: string[];
  author: {
    name: string;
    role?: string;
    userId?: Types.ObjectId;
  };
  featuredImage?: {
    url: string;
    alt?: string;
    caption?: string;
  };
  status: "draft" | "published" | "archived";
  featured: boolean;
  readTime?: number; // in minutes
  views: number;
commentsCount: number;
  commentsEnabled: boolean;
  likes: number;
  publishedAt?: Date;
  createdAt?: Date;
  metadata?: {
    seoTitle?: string;
    seoDescription?: string;
    keywords?: string[];
  };
  relatedArticles?: Types.ObjectId[];
}

const AdvocacyArticleSchema = new Schema<IAdvocacyArticle>(
  {
    title: {
      type: String,
      required: [true, "Article title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    excerpt: {
      type: String,
      required: [true, "Article excerpt is required"],
      maxlength: [500, "Excerpt cannot exceed 500 characters"],
    },
    content: {
      type: String,
      required: [true, "Article content is required"],
    },
    category: {
      type: String,
      enum: ["all","educational", "success-story", "policy-brief", "community-resource"],
      required: [true, "Category is required"],
      index: true,
    },
    tags: {
      type: [String],
      default: [],
      index: true,
    },
    author: {
      name: { type: String, required: true },
      role: { type: String },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
    },
    featuredImage: {
      url: { type: String },
      alt: { type: String },
      caption: { type: String },
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },
    featured: {
      type: Boolean,
      default: false,
      index: true,
    },
    readTime: {
      type: Number,
      default: 5,
    },
    views: {
      type: Number,
      default: 0,
    },
   commentsCount: {
      type: Number,
      default: 0,
    },
    commentsEnabled: {
      type: Boolean,
      default: true,
    },
  
    likes: {
      type: Number,
      default: 0,
    },
    publishedAt: {
      type: Date,
    },
    createdAt: {
        type: Date,
    },
    metadata: {
      seoTitle: { type: String },
      seoDescription: { type: String },
      keywords: [{ type: String }],
    },
    relatedArticles: [
      {
        type: Schema.Types.ObjectId,
        ref: "AdvocacyArticle",
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for search and filtering
AdvocacyArticleSchema.index({ title: "text", content: "text", tags: "text" });
AdvocacyArticleSchema.index({ category: 1, status: 1 });
AdvocacyArticleSchema.index({ featured: 1, publishedAt: -1 });
AdvocacyArticleSchema.index({ createdAt: -1 });

// Virtual for formatted date
// This virtual definition might still show warnings if not handled by a utility type,
// but let's focus on the pre-save hook first.
AdvocacyArticleSchema.virtual("formattedDate").get(function () {
  return this.publishedAt || this.createdAt;
});

// Add virtual for comments
AdvocacyArticleSchema.virtual("comments", {
  ref: "Comment",
  localField: "_id",
  foreignField: "articleId",
  match: { status: "approved", parentCommentId: null }, // Only top-level approved comments
});

// Pre-save middleware to auto-generate slug
// FIX: Explicitly declaring the type of 'this' (the document) resolves the unknown type error.
AdvocacyArticleSchema.pre("save", async function (this: IAdvocacyArticle, next) {
  if (this.isModified("title") && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();

    // Ensure unique slug
    let slugExists = await mongoose.models.AdvocacyArticle.findOne({ slug: this.slug });
    let counter = 1;
    let originalSlug = this.slug;

    // Use string coercion on _id to maintain compatibility
    while (slugExists && slugExists._id?.toString() !== this._id?.toString()) {
      this.slug = `${originalSlug}-${counter}`;
      slugExists = await mongoose.models.AdvocacyArticle.findOne({ slug: this.slug });
      counter++;
    }
  }

  // Auto-calculate read time (approx 200 words per minute)
  if (this.isModified("content")) {
    const wordCount = this.content.split(/\s+/).length;
    this.readTime = Math.ceil(wordCount / 200);
  }

  // Set publishedAt when status changes to published
  if (this.isModified("status") && this.status === "published" && !this.publishedAt) {
    this.publishedAt = new Date();
  }

  next();
});

export const AdvocacyArticle = mongoose.model<IAdvocacyArticle>(
  "AdvocacyArticle",
  AdvocacyArticleSchema
);