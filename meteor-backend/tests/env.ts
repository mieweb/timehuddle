/** Set (or, for undefined, delete) env vars for one test; returns a restore fn. */
export function withEnv(vars: Record<string, string | undefined>) {
  const saved = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(vars);
  return () => apply(saved);
}
