// One real call per job against the configured model: node --env-file=.env.local src/lib/ai/live-check.ts
import { setAiRecorder } from "./model.ts";
import { answerQuestion, resolveClaimIntent, scamVerdict } from "./jobs.ts";

setAiRecorder((r) => console.log("recorded", JSON.stringify(r)));
const live = { itemId: "it3", position: 3, variants: [{ key: "b1", label: "Blue" }, { key: "b2", label: "Navy Blue" }, { key: "r", label: "Red" }] };

console.log("claim ->", JSON.stringify(await resolveClaimIntent("woh blue wala", live, [1, 2])));
console.log("answer ->", JSON.stringify(await answerQuestion("COD hota hai kya? aur kitne ka hai", ["COD available", "Shipping 3-5 days"],
  { title: "Silk saree", pricePaise: 145000, note: null, variants: [{ label: "Red", left: 2 }] })));
console.log("scam ->", JSON.stringify(await scamVerdict("DM me for cheaper rate, inbox me bro")));
