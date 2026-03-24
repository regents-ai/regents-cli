import { describe } from "vitest";

const describeNetwork = Object.assign((name, fn) => describe(name, fn), {
  sequential: describe.sequential,
});

export { describeNetwork };
