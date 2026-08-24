import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

// Groq's chat model has a bounded context window shared with the running
// conversation history — cap how much of a document we stuff in so one
// upload can't crowd out everything else in the prompt.
const MAX_EXTRACTED_CHARS = 8000;

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_EXTRACTED_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n\n[...document truncated...]`;
}

// Best-effort text extraction for a just-uploaded chatbot document, so the
// AI can actually answer questions about it in this conversation. Returns
// null (never throws) for anything it can't handle — legacy binary .doc has
// no free extractor available, and scanned/image-only PDFs have no text
// layer for pdf-parse to find — callers should fall back to the existing
// "I shared a document called X" behavior in either case.
export async function extractDocumentText(buffer: Buffer, mimetype: string): Promise<string | null> {
  try {
    if (mimetype === "application/pdf") {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text.trim() ? truncate(result.text) : null;
    }

    if (mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim() ? truncate(result.value) : null;
    }

    return null;
  } catch (error: any) {
    console.error("[DocumentTextExtraction] error:", error.message);
    return null;
  }
}
