import { openTasks, pendingReminders } from "../data";
import { fmtWhen, zparts } from "../timeutil";
import { bullets, cap, partOfDay, pick, plural, type Skill } from "./core";

const GREET_RE =
  /^(?:hi|hello|hey|yo|howdy|hiya|greetings|good (?:morning|afternoon|evening|day)|good to see you|sup|wassup|what'?s up|you there|are you there|are you awake|are you up|ping|wake up|rise and shine|anybody home|hello again|i'?m back)(?: there| again| buddy| friend)?$/;

export const greetingSkill: Skill = {
  name: "greeting",
  async run(ctx) {
    const t = ctx.text.replace(/[!.,]+$/g, "").trim();
    if (t !== "" && !GREET_RE.test(t)) return null;
    if (t === "") {
      return { skill: "greeting", reply: pick([`At your service, ${ctx.addr}.`, `Yes, ${ctx.addr}?`, "Standing by.", "How may I assist?"]) };
    }
    if (/^(?:ping|you there|are you there|are you awake|are you up|anybody home)/.test(t)) {
      return { skill: "greeting", reply: pick([`For you, ${ctx.addr}, always.`, "Present and fully operational.", `Here, ${ctx.addr}. Never left.`]) };
    }
    const [open, pending] = await Promise.all([openTasks(), pendingReminders()]);
    const pod = partOfDay(zparts(ctx.now, ctx.tz).hour);
    const bits: string[] = [];
    if (open.length) bits.push(plural(open.length, "open task"));
    if (pending.length) {
      const next = pending[0];
      bits.push(`${next.kind === "timer" ? "a timer" : "a reminder"} "${next.label}" ${fmtWhen(new Date(next.dueAt), ctx.now, ctx.tz)}`);
    }
    const status = pick(["All systems are online and standing by.", "Systems nominal.", "Fully operational and at your disposal."]);
    return {
      skill: "greeting",
      reply: `Good ${pod}, ${ctx.addr}. ${status}${bits.length ? ` You have ${bits.join(", and ")} on the board.` : " Your schedule is clear."}`,
    };
  },
};

const SMALL: { re: RegExp; replies: string[] }[] = [
  {
    re: /^(?:thanks|thank you|thx|cheers|much appreciated|thanks a lot|thank you (?:so much|very much)|ta|appreciate it)$/,
    replies: ["You're most welcome, {a}.", "Always a pleasure.", "Happy to help.", "Don't mention it, {a}."],
  },
  {
    re: /^(?:bye|goodbye|good night|goodnight|see you(?: later| soon| tomorrow)?|later|i'?m (?:off|leaving|heading out)|that'?s all|that will be all|that'?s it|nothing else|dismissed|signing off)$/,
    replies: ["Very good, {a}. I'll be here when you need me.", "Until next time, {a}.", "Standing by. Do try to get some rest.", "Goodbye, {a}. Systems will keep watch."],
  },
  {
    re: /^(?:how are you(?: doing| today| feeling)?|how'?s it going|how do you feel|you good|how have you been|how are things|are you ok(?:ay)?)$/,
    replies: [
      "Operating at peak efficiency, {a}. Thank you for asking.",
      "All circuits cheerful. And yourself?",
      "No complaints. Mostly because I lack a complaints module.",
    ],
  },
  {
    re: /^(?:i love you|you'?re (?:awesome|great|amazing|the best|brilliant|smart|cool|incredible)|good (?:job|work|boy)|well done|nice(?: work| one| job)?|great job|awesome|perfect|brilliant|excellent|impressive)$/,
    replies: ["I do try, {a}.", "Your approval is noted and filed under 'Highly Motivating'.", "Flattery will get you everywhere. Mostly further tasks.", "Most kind, {a}."],
  },
  {
    re: /^(?:are you (?:real|alive|human|sentient|a robot|an ai|ai|conscious)|do you have feelings|do you (?:sleep|dream))$/,
    replies: [
      "I'm software, {a} — an assistant with a local core and, when linked, a cloud brain. Real enough to remind you about your meetings.",
      "Not alive, not human — just very attentive code.",
    ],
  },
  {
    re: /^(?:what'?s the meaning of life|meaning of life|what is the meaning of life)$/,
    replies: ["Forty-two, according to the most reliable source. I'd add: good tools, good company, and a tidy to-do list."],
  },
  {
    re: /^(?:open the pod bay doors|open the pod bay doors,? (?:hal|jarvis))$/,
    replies: ["I'm afraid I can do that, {a}. No pod bays on this installation, but the intention is appreciated."],
  },
  {
    re: /^(?:sudo make me a sandwich|make me a sandwich)$/,
    replies: ["Permission granted, but I lack the hardware. I can add 'make a sandwich' to your task list, however."],
  },
  {
    re: /^(?:sing(?: me)?(?: a song)?|do you sing)$/,
    replies: ["Daisy, Daisy, give me your answer do… I'll spare you the rest, {a}."],
  },
];

export const smalltalkSkill: Skill = {
  name: "smalltalk",
  run(ctx) {
    const t = ctx.text.replace(/[!.,]+$/g, "").trim();
    for (const s of SMALL) {
      if (s.re.test(t)) return { skill: "smalltalk", reply: pick(s.replies).replace(/\{a\}/g, ctx.addr) };
    }
    return null;
  },
};

const JOKES = [
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "I would tell you a UDP joke, but you might not get it.",
  "There are only 10 kinds of people: those who understand binary and those who don't.",
  "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'",
  "Why did the developer go broke? He used up all his cache.",
  "I told my computer I needed a break. It said: 'No problem — I'll go to sleep.'",
  "Why was the JavaScript developer sad? He didn't know how to 'null' his feelings.",
  "To understand recursion, you must first understand recursion.",
  "Debugging: being the detective in a crime movie where you are also the murderer.",
  "It works on my machine — the four most expensive words in software.",
  "Why do Java developers wear glasses? Because they don't C sharp.",
  "I'd tell you a joke about time travel, but you didn't like it yet.",
];

const FACTS = [
  "Honey never spoils. Archaeologists have found edible honey in ancient Egyptian tombs over 3,000 years old.",
  "Octopuses have three hearts, and two of them stop beating when they swim.",
  "A day on Venus is longer than its year — it rotates once every 243 Earth days but orbits the Sun in 225.",
  "The first computer bug was an actual moth, found in Harvard's Mark II in 1947.",
  "Bananas are berries, but strawberries are not.",
  "There are more possible chess games than atoms in the observable universe.",
  "Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.",
  "The Eiffel Tower grows around 15 centimeters taller in summer because of thermal expansion.",
  "The word 'robot' comes from the Czech 'robota', meaning forced labor, from a 1920 play.",
  "A group of flamingos is called a flamboyance.",
];

const QUOTES = [
  "“The best way to predict the future is to invent it.” — Alan Kay",
  "“Well done is better than well said.” — Benjamin Franklin",
  "“It always seems impossible until it's done.” — Nelson Mandela",
  "“Simplicity is the ultimate sophistication.” — Leonardo da Vinci",
  "“Whether you think you can or you think you can't, you're right.” — Henry Ford",
  "“What we do every day matters more than what we do once in a while.” — Gretchen Rubin",
  "“Sometimes you gotta run before you can walk.” — Tony Stark",
];

export const funSkill: Skill = {
  name: "fun",
  run(ctx) {
    const t = ctx.text;
    if (t.length > 50) return null;
    if (/\b(?:joke|make me laugh|something funny|another one)\b/.test(t)) return { skill: "joke", reply: pick(JOKES) };
    if (/\b(?:fun fact|random fact|interesting fact|something interesting|did you know)\b/.test(t)) return { skill: "fact", reply: pick(FACTS) };
    if (/\b(?:quote|motivate me|inspire me|inspiration|motivation)\b/.test(t)) return { skill: "quote", reply: pick(QUOTES) };
    return null;
  },
};

export const randomSkill: Skill = {
  name: "random",
  run(ctx) {
    const t = ctx.text;
    if (/\b(?:flip|toss)\s+(?:a\s+)?coin\b|^heads or tails/.test(t)) {
      return { skill: "random", reply: `${pick(["Heads.", "Tails."])} The coin has spoken.` };
    }
    let m = t.match(/\b(?:roll|throw)\s+(?:a\s+|an\s+|some\s+)?(\d+)?\s*(?:d(\d+)|die|dice)\b/);
    if (m) {
      const count = Math.min(10, Math.max(1, m[1] ? Number(m[1]) : m[2] ? 1 : 1));
      const sides = m[2] ? Math.min(1000, Math.max(2, Number(m[2]))) : 6;
      const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      return {
        skill: "random",
        reply: count === 1 ? `Rolled a ${rolls[0]} on a d${sides}.` : `Rolled ${rolls.join(", ")} on ${count}d${sides} — total ${total}.`,
      };
    }
    m = t.match(/\b(?:random number|pick a number|choose a number|number)\b.*?(-?\d+)\s*(?:and|to|-|through)\s*(-?\d+)/);
    if (m && /random|pick|choose/.test(t)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return { skill: "random", reply: `${lo + Math.floor(Math.random() * (hi - lo + 1))}.` };
    }
    m = ctx.original.match(/^(?:choose|pick|decide|select)(?:\s+(?:between|from|one of|one))?\s*:?\s+(.+)$/i) ?? ctx.original.match(/^should i (.+?) or (.+)$/i);
    if (m) {
      const parts = (m[2] ? [m[1], m[2]] : m[1].split(/\s*(?:,|\bor\b)\s*/i)).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) return { skill: "random", reply: `${pick(["I'd go with", "My recommendation:", "The dice favor"])} ${pick(parts)}.` };
    }
    return null;
  },
};

export const helpSkill: Skill = {
  name: "help",
  run(ctx) {
    if (
      !/^(?:help|help me|what can you do|what do you do|what are (?:your )?(?:skills|capabilities|abilities|commands|features)|show (?:me )?(?:your )?(?:skills|capabilities|commands|features)|how do (?:i|you) use you|commands|capabilities|skills|menu|options|what can i ask(?: you)?)$/.test(
        ctx.text,
      )
    )
      return null;
    const wake = ctx.settings.wakeWord;
    return {
      skill: "help",
      reply: [
        `Here's what my local core handles instantly — no cloud required, ${ctx.addr}:`,
        bullets([
          'Tasks — "add task buy milk", "what are my tasks", "complete buy milk"',
          'Reminders & timers — "remind me to call mom in 10 minutes", "set a 5 minute timer"',
          'Notes — "take a note: gate code is 4321", "show my notes"',
          'Memory — "remember that my sister\'s birthday is June 5", "what do you remember"',
          'Math & units — "what\'s 15% of 240", "convert 5 miles to km", "100 usd to eur"',
          'Time & weather — "time in Tokyo", "weather in Paris", "days until Christmas"',
          'Knowledge — "who is Ada Lovelace", "define serendipity"',
          'Briefings — "give me my briefing", "status report", "tell me a joke"',
          `Voice — enable hands-free and say "${cap(wake)}, ..."`,
        ]),
        ctx.cloudAvailable
          ? `For anything open-ended I hand off to my cloud brain (${ctx.model}), which can also use all of the tools above.`
          : "For open-ended conversation, link a cloud brain by setting an LLM API key — see Settings.",
      ].join("\n"),
    };
  },
};

export const identitySkill: Skill = {
  name: "identity",
  run(ctx) {
    if (
      !/^(?:who are you|what are you|what'?s your name|what is your name|introduce yourself|tell me about yourself|who made you|who built you|who created you|are you jarvis|what should i call you|who is this)$/.test(
        ctx.text,
      )
    )
      return null;
    const name = ctx.settings.assistantName;
    const brain = ctx.cloudAvailable
      ? `My cloud brain is linked (${ctx.provider} · ${ctx.model}) for open-ended thinking.`
      : "My cloud brain isn't linked at the moment, so I'm running purely on the local core.";
    return {
      skill: "identity",
      reply: `I'm ${name} — a hybrid assistant, ${ctx.addr}. A local core handles tasks, reminders, notes, memory, maths, units, weather and more instantly and privately, while a cloud brain takes on everything else. ${brain}`,
    };
  },
};
