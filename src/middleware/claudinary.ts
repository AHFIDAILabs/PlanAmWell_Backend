import { v2 as cloudinary } from "cloudinary";
require("../config/claudinary"); // This should configure cloudinary

/**
 * Upload Images to Cloudinary
 * @param buffer - image buffer
 * @param folder - Cloudinary folder name
 */
export const uploadToCloudinary = async (
  buffer: Buffer,
  folder: string
): Promise<{ secure_url: string; public_id: string }> => {
  try {
    if (!Buffer.isBuffer(buffer)) {
      throw new Error("Invalid buffer provided for upload");
    }

    const base64 = buffer.toString("base64");
    const dataURI = `data:image/jpeg;base64,${base64}`;

    const { secure_url, public_id } = await cloudinary.uploader.upload(dataURI, { folder });
    return { secure_url, public_id };
  } catch (error: any) {
    console.error("Cloudinary Upload Error (Image):", error.message);
    throw new Error("Error uploading image to Cloudinary");
  }
};

/**
 * Upload Videos to Cloudinary
 */
export const uploadVideoToCloudinary = async (
  buffer: Buffer,
  folderPath: string
): Promise<{ videoUrl: string; videoCldId: string }> => {
  try {
    if (!Buffer.isBuffer(buffer)) throw new Error("Invalid buffer provided for upload");

    const base64 = buffer.toString("base64");
    const dataURI = `data:video/mp4;base64,${base64}`;

    const { secure_url: videoUrl, public_id: videoCldId } = await cloudinary.uploader.upload(dataURI, {
      resource_type: "video",
      folder: folderPath,
    });

    return { videoUrl, videoCldId };
  } catch (error: any) {
    console.error("Cloudinary Upload Error (Video):", error.message);
    throw new Error("Error uploading video to Cloudinary");
  }
};

/**
 * Upload Documents (PDF, DOCX, etc.) to Cloudinary
 */
export const uploadDocumentToCloudinary = async (
  buffer: Buffer,
  folderPath: string,
  mimetype: string
): Promise<{ fileUrl: string; fileCldId: string }> => {
  try {
    if (!Buffer.isBuffer(buffer)) throw new Error("Invalid buffer provided for upload");

    const base64 = buffer.toString("base64");
    const dataURI = `data:${mimetype};base64,${base64}`;

    const { secure_url: fileUrl, public_id: fileCldId } = await cloudinary.uploader.upload(dataURI, {
      resource_type: "raw",
      folder: folderPath,
    });

    return { fileUrl, fileCldId };
  } catch (error: any) {
    console.error("Cloudinary Upload Error (Document):", error.message);
    throw new Error("Error uploading document to Cloudinary");
  }
};

/**
 * Delete file from Cloudinary
 */
export const deleteFromCloudinary = async (publicId: string): Promise<any> => {
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (error: any) {
    console.error("Cloudinary Delete Error:", error.message);
    throw new Error("Error deleting file from Cloudinary");
  }
};


/**
 * Optimized for Audio/Video (transcribable and streamable)
 */
export const uploadMediaToCloudinary = async (
  buffer: Buffer,
  folderPath: string,
  mimetype: string
): Promise<{ url: string; publicId: string }> => {
  try {
    const base64 = buffer.toString("base64");
    const dataURI = `data:${mimetype};base64,${base64}`;

    const { secure_url, public_id } = await cloudinary.uploader.upload(dataURI, {
      // "video" allows Cloudinary to treat audio files as playable media
      resource_type: "video", 
      folder: folderPath,
    });

    return { url: secure_url, publicId: public_id };
  } catch (error: any) {
    console.error("Cloudinary Media Error:", error.message);
    throw new Error("Failed to upload media");
  }
};