import { readMirrorConfig } from "./config.mjs";
import { buildSnapshot } from "./snapshot.mjs";

const snapshot = await buildSnapshot(readMirrorConfig());
console.log(JSON.stringify({ generation: snapshot.generation, plugins: snapshot.plugins.length, skills: snapshot.skills.length }));
