import { API_MEMBERS } from "./api-contract";

type AnyFunction = (...args: unknown[]) => unknown;
type CachedMethod = { source: AnyFunction; wrapper: AnyFunction };

export function createRuntimeView(disabled: Set<string>) {
  const rawToProxy = new WeakMap<object, object>();
  const proxyToRaw = new WeakMap<object, object>();
  const methodCache = new WeakMap<object, Map<PropertyKey, CachedMethod>>();

  function project<T>(value: T): T {
    if (!isObject(value)) return value;
    if (proxyToRaw.has(value)) return value;
    if (value instanceof Promise) return value.then((result) => project(result)) as T;
    if (Array.isArray(value)) return value.map((item) => project(item)) as T;
    if (typeof value === "function") return value;

    const interfaceName = getInterfaceName(value);
    if (interfaceName) return proxyFor(value, interfaceName) as T;

    return projectObjectFields(value) as T;
  }

  function proxyFor(target: object, interfaceName: string): object {
    const cached = rawToProxy.get(target);
    if (cached) return cached;

    const proxy = new Proxy(target, {
      get(target, property) {
        if (isHidden(interfaceName, property)) return undefined;

        const value = Reflect.get(target, property, target);
        if (typeof value === "function") return methodFor(target, property, value);
        return project(value);
      },

      has(target, property) {
        return !isHidden(interfaceName, property) && Reflect.has(target, property);
      },

      ownKeys(target) {
        return Reflect.ownKeys(target).filter((property) => !isHidden(interfaceName, property));
      },

      getOwnPropertyDescriptor(target, property) {
        if (isHidden(interfaceName, property)) return undefined;

        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (!descriptor || !("value" in descriptor)) return descriptor;
        return { ...descriptor, value: project(descriptor.value) };
      },
    });

    rawToProxy.set(target, proxy);
    proxyToRaw.set(proxy, target);
    return proxy;
  }

  function methodFor(target: object, property: PropertyKey, source: AnyFunction): AnyFunction {
    let methods = methodCache.get(target);
    if (!methods) {
      methods = new Map();
      methodCache.set(target, methods);
    }

    const cached = methods.get(property);
    if (cached?.source === source) return cached.wrapper;

    const wrapper = (...args: unknown[]) => {
      return project(source.apply(target, args.map((arg) => unwrap(arg))));
    };
    methods.set(property, { source, wrapper });
    return wrapper;
  }

  function unwrap<T>(value: T): T {
    if (!isObject(value)) return value;
    return (proxyToRaw.get(value) as T | undefined) ?? value;
  }

  function projectObjectFields<T extends object>(value: T): T {
    let copy: T | undefined;

    for (const property of Reflect.ownKeys(value)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
      if (!descriptor || !("value" in descriptor)) continue;

      const projected = project(descriptor.value);
      if (projected === descriptor.value) continue;

      copy ??= cloneObject(value);
      Object.defineProperty(copy, property, { ...descriptor, value: projected });
    }

    return copy ?? value;
  }

  return project;

  function isHidden(interfaceName: string, property: PropertyKey): boolean {
    return typeof property === "string" && disabled.has(`${interfaceName}.${property}`);
  }
}

function getInterfaceName(value: object): string | null {
  const name = value.constructor?.name;
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(API_MEMBERS, name)
    ? name
    : null;
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function cloneObject<T extends object>(value: T): T {
  const copy = Object.create(Object.getPrototypeOf(value));
  for (const property of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, property);
    if (descriptor) Object.defineProperty(copy, property, descriptor);
  }
  return copy;
}
