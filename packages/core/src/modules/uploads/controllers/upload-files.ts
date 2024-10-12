import { fileSize } from "@mongez/fs";
import { Random, ltrim } from "@mongez/reinforcements";
import type { Request, Response, UploadedFile } from "../../../http";
import { uploadsPath } from "../../../utils";
import { Upload } from "../models/upload";
import { uploadFromUrl } from "../utils";
import { getUploadsDirectory } from "../utils/get-uploads-directory";

async function uploadFilesList(
  files: UploadedFile[],
  uploads: Upload[],
  baseDirectoryPath: string,
  isRandom: boolean,
) {
  const addFile = async (file: UploadedFile) => {
    const hash = Random.string(64);
    const fileDirectoryPath = baseDirectoryPath + "/" + hash;

    const fileName = file.name;
    const filePath = isRandom
      ? await file.save(fileDirectoryPath)
      : await file.saveAs(fileDirectoryPath, fileName); // relative to uploadsPath

    const fileData: any = {
      name: file.name,
      fileHash: file.hash,
      hash: hash,
      path: ltrim(filePath, "/"),
      directory: fileDirectoryPath,
      size: fileSize(uploadsPath(filePath)),
      mimeType: file.mimeType,
      extension: file.extension,
    };

    if (file.isImage) {
      const { width, height } = await file.dimensions();
      fileData.width = width;
      fileData.height = height;
    }

    const upload = new Upload(fileData);

    await upload.save();

    uploads.push(upload);

    return upload;
  };

  const uploadedFiles: Promise<Upload>[] = [];

  if (Array.isArray(files)) {
    for (const file of files) {
      uploadedFiles.push(addFile(file));
    }

    await Promise.all(uploadedFiles);
  } else {
    await addFile(files as UploadedFile);
  }
}

async function uploadFromUrlsList(
  urls: string[],
  uploads: Upload[],
  baseDirectoryPath: string,
) {
  await Promise.all(
    urls.map(async url => {
      const upload = await uploadFromUrl(url, baseDirectoryPath);

      uploads.push(upload);
    }),
  );
}

export async function uploadFiles(request: Request, response: Response) {
  const files = request.files("uploads");
  const urls = request.input("urls");
  const directory = request.input("directory");
  const isRandom = request.bool("random");

  if (!files && !urls) {
    return response.badRequest({
      error: "No files or urls provided",
    });
  }

  const uploads: Upload[] = [];
  const baseDirectoryPath = await getUploadsDirectory(directory);

  if (urls) {
    await uploadFromUrlsList(urls, uploads, baseDirectoryPath);
  }

  if (files) {
    await uploadFilesList(files, uploads, baseDirectoryPath, isRandom);
  }

  return response.success({
    uploads,
  });
}

uploadFiles.validation = {
  rules: {
    uploads: ["array", "file"],
    urls: ["array", "arrayOf:string"],
    directory: ["string"],
    random: ["boolean"],
  },
};
