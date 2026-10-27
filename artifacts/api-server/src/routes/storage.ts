import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, issuesTable, storageUploadsTable } from "@workspace/db";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { canAccessHome, requireMember } from "../lib/access";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const maxUploadBytes = 10 * 1024 * 1024;
const allowedTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

router.use(requireMember);

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.size > maxUploadBytes) {
    res.status(400).json({ error: "Attachments must be 10 MB or smaller" });
    return;
  }
  if (!allowedTypes.has(parsed.data.contentType.toLowerCase())) {
    res.status(400).json({
      error: "Upload a PDF, JPG, PNG, WebP, or Word document",
    });
    return;
  }
  try {
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    const fileName = parsed.data.name
      .replace(/[\r\n]/g, "")
      .replace(/[\\/]/g, "_")
      .slice(0, 180);
    await db.insert(storageUploadsTable).values({
      objectPath,
      ownerUserId: req.actor!.userId,
      homeId: req.actor!.homeId,
      fileName,
      contentType: parsed.data.contentType,
      size: parsed.data.size,
    });
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Failed to create private upload URL");
    res.status(500).json({ error: "Unable to prepare this attachment" });
  }
});

router.get("/storage/objects/*objectPath", async (req, res): Promise<void> => {
  const rawPath = req.params.objectPath;
  const pathPart = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  if (
    !pathPart.startsWith("uploads/") ||
    pathPart.split("/").some((segment) => segment === "..")
  ) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  const objectPath = `/objects/${pathPart}`;
  const [upload] = await db
    .select()
    .from(storageUploadsTable)
    .where(eq(storageUploadsTable.objectPath, objectPath))
    .limit(1);
  if (!upload?.issueId) {
    res.status(404).json({ error: "Attachment not found" });
    return;
  }
  const [issue] = await db
    .select({ homeId: issuesTable.homeId })
    .from(issuesTable)
    .where(eq(issuesTable.id, upload.issueId))
    .limit(1);
  if (!issue || !canAccessHome(req.actor!, issue.homeId)) {
    res.status(403).json({ error: "You cannot access this attachment" });
    return;
  }
  try {
    const file = await objectStorage.getObjectEntityFile(objectPath);
    const response = await objectStorage.downloadObject(file, 0);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const safeName = upload.fileName.replace(/["\\\r\n]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    req.log.error({ err: error }, "Failed to serve private attachment");
    res.status(500).json({ error: "Unable to serve attachment" });
  }
});

export default router;
