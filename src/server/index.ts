import { serve } from "@hono/node-server";
import { createServerApp } from "./app";
import { createServices } from "./services";

const services = createServices();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

serve(
  {
    fetch: createServerApp(services).fetch,
    port,
    hostname: host
  },
  (info) => {
    console.log(`Anki Web listening on http://${host}:${info.port}`);
  }
);
