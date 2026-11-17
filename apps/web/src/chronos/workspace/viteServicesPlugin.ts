import type { Plugin, ProxyOptions } from "vite-plus";
import { LOCAL_SERVICES } from "./serviceDefinitions";

export function chronosServicesPlugin(): Plugin {
  return {
    name: "chronos:local-services",
    apply: "serve",
    config() {
      return {
        server: {
          proxy: Object.fromEntries(
            Object.entries(LOCAL_SERVICES).map(([id, service]) => {
              const prefix = `/chronos-local/${id}`;
              const options: ProxyOptions = {
                target: `http://127.0.0.1:${service.port}`,
                changeOrigin: true,
                rewrite: (path) => path.slice(prefix.length) || "/",
                configure: (proxy) =>
                  proxy.on("proxyReq", (request) => {
                    request.removeHeader("origin");
                    request.removeHeader("cookie");
                    request.removeHeader("authorization");
                  }),
              };
              return [prefix, options];
            }),
          ),
        },
      };
    },
  };
}
