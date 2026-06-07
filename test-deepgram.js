const { createClient } = require("@deepgram/sdk");
const deepgram = createClient("0e3476f90ed6a92770c760771a50ee652564cde7");
const connection = deepgram.listen.live({
  model: "nova-2",
  language: "en",
  smart_format: true,
  interim_results: true,
  utterance_end_ms: 1000,
  endpointing: 200,
  vad_events: true,
  multichannel: true,
  channels: 2,
  encoding: "linear16",
  sample_rate: 48000,
});
connection.on("open", () => { console.log("OPEN"); process.exit(0); });
connection.on("error", (err) => { console.error("ERROR:", JSON.stringify(err, Object.getOwnPropertyNames(err))); process.exit(1); });
