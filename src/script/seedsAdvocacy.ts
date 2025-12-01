// backend/script/seedsAdvocacy.ts
import mongoose from "mongoose";
import { AdvocacyArticle } from "../models/advocacy";
import dotenv from "dotenv";
import slugify from "slugify";

dotenv.config();

const sampleArticles = [
  {
    title: "Understanding Your Menstrual Cycle",
    excerpt:
      "Learn about the phases of your menstrual cycle and what's normal for your body.",
    content: `
      <h2>Introduction</h2>
      <p>Understanding your menstrual cycle is crucial for reproductive health...</p>
      <h2>The Four Phases</h2>
      <p>1. Menstruation Phase...</p>
      <p>2. Follicular Phase...</p>
      <p>3. Ovulation Phase...</p>
      <p>4. Luteal Phase...</p>
      <h2>Conclusion</h2>
      <p>Tracking your cycle helps you understand your body better...</p>
    `,
    category: "educational",
    tags: ["menstruation", "reproductive-health", "women-health"],
    author: {
      name: "Dr. Aisha Bello",
      role: "OB/GYN Specialist",
    },
    featuredImage: {
      url: "https://example.com/menstrual-cycle.jpg",
      alt: "Menstrual cycle diagram",
    },
    status: "published",
    featured: true,
  },
  {
    title: "Navigating PCOS: Symptoms & Management",
    excerpt:
      "A comprehensive guide to understanding and managing Polycystic Ovary Syndrome.",
    content: `
      <h2>What is PCOS?</h2>
      <p>PCOS is a hormonal disorder affecting women of reproductive age...</p>
      <h2>Common Symptoms</h2>
      <ul>
        <li>Irregular periods</li>
        <li>Excess androgens</li>
        <li>Polycystic ovaries</li>
      </ul>
      <h2>Management Strategies</h2>
      <p>Lifestyle changes, medications, and regular monitoring...</p>
    `,
    category: "educational",
    tags: ["PCOS", "hormones", "reproductive-health"],
    author: {
      name: "Dr. Funke Adeyemi",
      role: "Endocrinologist",
    },
    status: "published",
    featured: true,
  },
  {
    title: "Fertility 101: What You Need to Know",
    excerpt: "Essential information about fertility, conception, and reproductive health.",
    content: `
      <h2>Understanding Fertility</h2>
      <p>Fertility depends on multiple factors...</p>
      <h2>Optimizing Your Fertility</h2>
      <p>Tips for improving reproductive health...</p>
    `,
    category: "educational",
    tags: ["fertility", "conception", "family-planning"],
    author: {
      name: "Dr. Bisi Okafor",
      role: "Fertility Specialist",
    },
    status: "published",
    featured: false,
  },
  {
    title: "Choosing the Right Contraception for You",
    excerpt: "Explore different contraceptive options and find what works best for your lifestyle.",
    content: `
      <h2>Types of Contraception</h2>
      <p>From barrier methods to hormonal options...</p>
      <h2>Making Your Choice</h2>
      <p>Consider effectiveness, side effects, and personal preferences...</p>
    `,
    category: "policy-brief",
    tags: ["contraception", "family-planning", "sexual-health"],
    author: {
      name: "Nurse Chioma Eze",
      role: "Sexual Health Educator",
    },
    status: "published",
    featured: false,
  },
];

// Auto-generate slugs
const sampleArticlesWithSlugs = sampleArticles.map(article => ({
  ...article,
  slug: slugify(article.title, { lower: true, strict: true }),
}));

const seedAdvocacy = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI!);
    console.log("✅ Connected to MongoDB");

    // Clear existing articles
    await AdvocacyArticle.deleteMany({});
    console.log("🗑️ Cleared existing articles");

    // Insert seed articles
    const created = await AdvocacyArticle.insertMany(sampleArticlesWithSlugs);
    console.log(`✅ Created ${created.length} articles`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error);
    process.exit(1);
  }
};

seedAdvocacy();
