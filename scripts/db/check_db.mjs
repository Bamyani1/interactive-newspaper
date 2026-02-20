import { neon } from "@neondatabase/serverless";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirnameEnv, "../../.env.local");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
    const result = await sql`SELECT date FROM editions ORDER BY date;`;
    console.log(`DB Count: ${result.length}`);
    console.log(`DB Dates: ${result.map(r => new Date(r.date).toISOString().split('T')[0]).join(', ')}`);
}

main().catch(console.error);
