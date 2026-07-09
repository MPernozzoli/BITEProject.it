import { useSyncExternalStore } from "react";

import { supabase } from "@/integrations/supabase/client";

export type AdminMediaBucket = "homepage-media" | "logbook-media";

export type AdminMediaUploadTaskStatus = "queued" | "uploading" | "completed" | "failed";

export type AdminMediaUploadTask = {
  id: string;
  bucket: AdminMediaBucket;
  folder: string;
  fileName: string;
  size: number;
  objectPath: string;
  publicUrl: string;
  progress: number;
  loaded: number;
  status: AdminMediaUploadTaskStatus;
  error?: string;
};

export type AdminMediaUploadSnapshot = {
  tasks: AdminMediaUploadTask[];
  totalBytes: number;
  uploadedBytes: number;
  progress: number;
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  failedCount: number;
  isUploading: boolean;
  lastCompletedUrls: string[];
  revision: number;
};

type EnqueueUploadInput = {
  files: File[];
  bucket: AdminMediaBucket;
  folder: string;
  buildObjectPath: (file: File, index: number) => string;
  buildPublicUrl: (path: string) => string;
};

const MAX_CONCURRENT_UPLOADS = 3;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const filesByTaskId = new Map<string, File>();
const listeners = new Set<() => void>();

let tasks: AdminMediaUploadTask[] = [];
let revision = 0;
let activeUploads = 0;
let snapshot: AdminMediaUploadSnapshot = buildSnapshot();

function buildSnapshot(): AdminMediaUploadSnapshot {
  const totalBytes = tasks.reduce((sum, task) => sum + task.size, 0);
  const uploadedBytes = tasks.reduce((sum, task) => {
    if (task.status === "completed") return sum + task.size;
    return sum + task.loaded;
  }, 0);
  const activeCount = tasks.filter((task) => task.status === "uploading").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const completedCount = tasks.filter((task) => task.status === "completed").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;

  return {
    tasks: tasks.map((task) => ({ ...task })),
    totalBytes,
    uploadedBytes,
    progress: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0,
    activeCount,
    queuedCount,
    completedCount,
    failedCount,
    isUploading: activeCount > 0 || queuedCount > 0,
    lastCompletedUrls: tasks
      .filter((task) => task.status === "completed")
      .slice(-10)
      .map((task) => task.publicUrl),
    revision,
  };
}

function emitChange() {
  revision += 1;
  snapshot = buildSnapshot();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateTask(taskId: string, updates: Partial<AdminMediaUploadTask>) {
  tasks = tasks.map((task) => (task.id === taskId ? { ...task, ...updates } : task));
  emitChange();
}

function storageUploadUrl(bucket: AdminMediaBucket, objectPath: string) {
  const encodedPath = objectPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodedPath}`;
}

function xhrUpload(task: AdminMediaUploadTask, file: File, accessToken: string) {
  return new Promise<void>((resolve, reject) => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      reject(new Error("Configurazione Supabase mancante."));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", storageUploadUrl(task.bucket, task.objectPath));
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.min(99, Math.round((event.loaded / event.total) * 100));
      updateTask(task.id, {
        loaded: Math.round((progress / 100) * task.size),
        progress,
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        updateTask(task.id, {
          status: "completed",
          loaded: task.size,
          progress: 100,
          error: undefined,
        });
        resolve();
        return;
      }

      reject(new Error(xhr.responseText || `Upload non riuscito (${xhr.status}).`));
    };

    xhr.onerror = () => reject(new Error("Errore di rete durante l'upload."));
    xhr.onabort = () => reject(new Error("Upload interrotto."));

    const body = new FormData();
    body.append("cacheControl", "31536000");
    body.append("", file);
    xhr.send(body);
  });
}

async function runTask(task: AdminMediaUploadTask) {
  const file = filesByTaskId.get(task.id);
  if (!file) {
    updateTask(task.id, { status: "failed", error: "File non più disponibile." });
    return;
  }

  activeUploads += 1;
  updateTask(task.id, { status: "uploading" });

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Sessione admin scaduta.");

    await xhrUpload(task, file, accessToken);
  } catch (error) {
    updateTask(task.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Upload non riuscito.",
    });
  } finally {
    activeUploads -= 1;
    filesByTaskId.delete(task.id);
    void pumpQueue();
  }
}

async function pumpQueue() {
  while (activeUploads < MAX_CONCURRENT_UPLOADS) {
    const nextTask = tasks.find((task) => task.status === "queued");
    if (!nextTask) return;
    void runTask(nextTask);
  }
}

export function enqueueAdminMediaUploads(input: EnqueueUploadInput) {
  const createdAt = Date.now();
  const newTasks = input.files.map((file, index) => {
    const objectPath = input.buildObjectPath(file, index);
    const task: AdminMediaUploadTask = {
      id: `${createdAt}-${index}-${Math.random().toString(36).slice(2)}`,
      bucket: input.bucket,
      folder: input.folder,
      fileName: file.name,
      size: file.size,
      objectPath,
      publicUrl: input.buildPublicUrl(objectPath),
      progress: 0,
      loaded: 0,
      status: "queued",
    };
    filesByTaskId.set(task.id, file);
    return task;
  });

  tasks = [...tasks, ...newTasks];
  emitChange();
  void pumpQueue();
  return newTasks;
}

export function clearCompletedAdminMediaUploads() {
  tasks = tasks.filter((task) => task.status !== "completed" && task.status !== "failed");
  emitChange();
}

export function useAdminMediaUploadQueue() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
