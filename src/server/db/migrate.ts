import { buildConfig } from "../config";
import { openDatabase } from "./client";

const { db } = openDatabase(buildConfig().databaseUrl);
db.close();
console.log("Database migrated");
