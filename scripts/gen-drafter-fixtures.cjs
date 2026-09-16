// One-off generator for tests/fixtures/drafter/*.json (Goal 8 eval set).
const fs = require("fs");
const path = require("path");

const C0 = {
  step1Done: true,
  step2Done: false,
  step3Done: false,
  step4Done: false,
  specAnswers: [],
  openChanges: 0,
  approach: "already_selling",
};
const C2 = { ...C0, step2Done: true };
const C3 = { ...C2, step3Done: true };

const S = [
  ["greet-1", "Hi", C0, "none"],
  ["greet-2", "hello", C0, "none"],
  ["ack-ok", "ok", C0, "none"],
  ["ack-received", "received", C0, "none"],
  ["ack-cn", "收到", C0, "none"],
  ["ack-emoji", "👍", C0, "none"],
  ["ack-wait", "please wait", C0, "none"],
  ["ack-thanks", "thanks!", C0, "none"],
  ["quote-1", "Our price is $2.50 per unit FOB.", C2, "draft"],
  ["quote-2", "Best quote 300 USD for 500pcs.", C2, "draft"],
  ["moq-1", "MOQ is 1000 pieces.", C2, "question"],
  ["pay-1", "We need 30% deposit by T/T.", C2, "question"],
  ["vol-1", "How many pcs per month do you need?", C2, "question"],
  ["fee-1", "Sample fee is $30, refundable on order.", C2, "fee"],
  ["fee-2", "We charge for samples, $20 each.", C2, "fee"],
  ["canmake-1", "Yes, we can make this product.", C0, "draft"],
  ["canmake-2", "No problem, we manufacture this kind.", C0, "draft"],
  ["speclocked-1", "We propose 70/30 blend instead of 75/25.", C2, "draft"],
  ["specflex-1", "Can we use a slightly different carton size?", C2, "draft"],
  ["specconfirm-1", "Spec confirmed, we will follow it exactly.", { ...C2, openChanges: 0 }, "question"],
  ["specconfirm-2", "Spec confirmed, we will follow it exactly.", { ...C3, openChanges: 0 }, "draft"],
  ["commit-1", "We will send the sample tomorrow.", C3, "draft"],
  ["tracking-1", "Shipped, tracking SF1234567890123.", C3, "draft"],
  ["question-spec", "What is the material composition?", { ...C2, specAnswers: ["Material: 75% cotton"] }, "draft"],
  ["question-gap", "Do you need OEKO-TEX certification?", C2, "question"],
  ["opener-fresh", "", { ...C0, approach: "fresh" }, "none"],
  ["cn-greet", "你好", C0, "none"],
  ["ambi-1", "Ok, price $3, can make it.", C2, "draft"],
  ["long-thanks", "Thank you very much for your message, we received it.", C0, "none"],
  ["dimension-q", "What are the dimensions?", { ...C2, specAnswers: ["Dimensions: 10x8x6cm"] }, "draft"],
];
const dir = path.join(__dirname, "..", "tests", "fixtures", "drafter");
fs.mkdirSync(dir, { recursive: true });
for (const [id, message, ctx, expected] of S) {
  fs.writeFileSync(
    path.join(dir, id + ".json"),
    JSON.stringify({ id, message, ctx, expected: { action: expected } }, null, 2),
  );
}
console.log("wrote", S.length, "fixtures");
