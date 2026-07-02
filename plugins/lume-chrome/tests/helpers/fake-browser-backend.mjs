const DEFAULT_NAMES = {
  extension: "Lume Chrome",
  iab: "Lume Local Browser",
  cdp: "Lume CDP",
};

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createFakeBackend(options = {}) {
  const type = options.type ?? "iab";
  const descriptor = {
    id: options.id ?? type,
    name: options.name ?? DEFAULT_NAMES[type] ?? "Lume Browser",
    type,
    protocolVersion: 5,
    generation: options.generation ?? "fake",
    metadata: options.metadata ?? {},
    capabilities: {
      browser: options.capabilities?.browser ?? [],
      tab: options.capabilities?.tab ?? [],
    },
    apiSupportOverrides: options.apiSupportOverrides ?? {},
  };
  const calls = [];
  const responses = new Map(Object.entries({
    runtime_list_browsers: [descriptor],
    runtime_ping: descriptor,
    ...(options.responses ?? {}),
  }));

  return {
    calls,
    descriptor,
    respond(method, result) {
      responses.set(method, result);
    },
    transport: {
      async send(method, params) {
        calls.push({ method, params });
        if (!responses.has(method)) {
          throw new Error(`No fake response for ${method}`);
        }

        const response = responses.get(method);
        const result = typeof response === "function"
          ? await response(params, { method, calls, descriptor })
          : response;
        return clone(result);
      },
    },
  };
}
