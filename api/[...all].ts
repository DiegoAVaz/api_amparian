import { createApp } from "../src/app";
import { getEnv } from "../src/config/env";

getEnv();

const app = createApp();

export default app;

