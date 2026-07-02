import { API_MEMBERS } from "./api-contract";

type AnyFunction = (...args: unknown[]) => unknown;
type CachedMethod = { source: AnyFunction; wrapper: AnyFunction };

export function createRuntimeView(disabled: Set<string>) {
  const rawToProxy = new WeakMap<object, object>();
  const proxyToRaw = new WeakMap<object, object>();
  const methodCache = new WeakMap<object, Map<PropertyKey, CachedMethod>>();
  const prototypeCache = new WeakMap<object, Map<string, object>>();

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

  function proxyFor(raw: object, interfaceName: string): object {
    const cached = rawToProxy.get(raw);
    if (cached) return cached;

    const shadow = Object.create(sanitizedPrototypeFor(raw, interfaceName));
    const proxy = new Proxy(shadow, {
      get(_target, property) {
        if (isHidden(interfaceName, property)) return undefined;

        const value = Reflect.get(raw, property, raw);
        if (typeof value === "function") return methodFor(raw, property, value);
        return project(value);
      },

      has(_target, property) {
        return !isHidden(interfaceName, property) && Reflect.has(raw, property);
      },

      ownKeys() {
        return Reflect.ownKeys(raw).filter((property) => !isHidden(interfaceName, property));
      },

      getOwnPropertyDescriptor(_target, property) {
        if (isHidden(interfaceName, property)) return undefined;

        const descriptor = Reflect.getOwnPropertyDescriptor(raw, property);
        if (!descriptor) return undefined;
        if (!("value" in descriptor)) return { ...descriptor, configurable: true };
        return { ...descriptor, configurable: true, value: project(descriptor.value) };
      },
    });

    rawToProxy.set(raw, proxy);
    proxyToRaw.set(proxy, raw);
    return proxy;
  }

  function sanitizedPrototypeFor(raw: object, interfaceName: string): object | null {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype === null) return null;
    return sanitizedPrototype(prototype, interfaceName);
  }

  function sanitizedPrototype(prototype: object, interfaceName: string): object {
    let cachedByInterface = prototypeCache.get(prototype);
    if (!cachedByInterface) {
      cachedByInterface = new Map();
      prototypeCache.set(prototype, cachedByInterface);
    }

    const cached = cachedByInterface.get(interfaceName);
    if (cached) return cached;

    const parent = Object.getPrototypeOf(prototype);
    const sanitized = Object.create(parent === null ? null : sanitizedPrototype(parent, interfaceName));
    cachedByInterface.set(interfaceName, sanitized);

    for (const property of Reflect.ownKeys(prototype)) {
      if (property === "constructor" || isHidden(interfaceName, property)) continue;

      const descriptor = Reflect.getOwnPropertyDescriptor(prototype, property);
      if (descriptor) Object.defineProperty(sanitized, property, descriptor);
    }

    return sanitized;
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
