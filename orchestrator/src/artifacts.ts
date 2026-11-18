import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Storage } from "@google-cloud/storage";
import { datesFrom, HORIZON } from "./ridership";
import type { SavedForecast } from "./weekly";

interface ArtifactStore {
  list(): Promise<string[]>;
  read(key: string): Promise<SavedForecast>;
  publish(key: string, value: SavedForecast): Promise<boolean>;
}

const WEEK_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

function keyedForecast(key: string, text: string): SavedForecast {
  const value: unknown = JSON.parse(text);
  const asOf = key.slice(0, -5);
  const dates = datesFrom(asOf);
  if (
    typeof value !== "object" ||
    value === null ||
    !("asOf" in value) ||
    value.asOf !== asOf ||
    !("source" in value) ||
    typeof value.source !== "string" ||
    !("dates" in value) ||
    !matchesDates(value.dates, dates) ||
    !("forecast" in value) ||
    !isForecast(value.forecast) ||
    !("baselineForecast" in value) ||
    !isForecast(value.baselineForecast)
  )
    throw new Error(`Invalid forecast artifact: ${key}.`);

  return {
    asOf,
    source: value.source,
    dates,
    forecast: value.forecast,
    baselineForecast: value.baselineForecast,
  };
}

function isForecast(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === HORIZON &&
    value.every(
      (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0,
    )
  );
}

function matchesDates(value: unknown, dates: string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === dates.length &&
    dates.every((date, index) => date === value[index])
  );
}

function isErrorCode(error: unknown, code: string | number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function localArtifacts(
  directory: string,
): Promise<ArtifactStore> {
  await mkdir(directory, { recursive: true });
  return {
    async list() {
      return (await readdir(directory)).filter((name) => WEEK_FILE.test(name));
    },
    async read(key) {
      return keyedForecast(key, await readFile(join(directory, key), "utf8"));
    },
    async publish(key, value) {
      const staging = join(directory, `${randomUUID()}.tmp`);
      await writeFile(staging, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
      });
      try {
        await link(staging, join(directory, key));
        return true;
      } catch (error) {
        if (isErrorCode(error, "EEXIST")) return false;
        throw error;
      } finally {
        await unlink(staging);
      }
    },
  };
}

export function cloudArtifacts(bucketName: string): ArtifactStore {
  const bucket = new Storage().bucket(bucketName);
  const prefix = "forecasts/";
  return {
    async list() {
      const [files] = await bucket.getFiles({ prefix });
      return files
        .map(({ name }) => name.slice(prefix.length))
        .filter((name) => WEEK_FILE.test(name));
    },
    async read(key) {
      const [bytes] = await bucket.file(`${prefix}${key}`).download();
      return keyedForecast(key, bytes.toString("utf8"));
    },
    async publish(key, value) {
      try {
        await bucket
          .file(`${prefix}${key}`)
          .save(JSON.stringify(value, null, 2) + "\n", {
            contentType: "application/json",
            resumable: false,
            preconditionOpts: { ifGenerationMatch: 0 },
          });
        return true;
      } catch (error) {
        if (isErrorCode(error, 412)) return false;
        throw error;
      }
    },
  };
}
