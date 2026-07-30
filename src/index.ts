import { createApp } from "./app";
import { getEnv } from "./config/env";

const env = getEnv();

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Amparian API em http://localhost:${env.PORT}`);
});

