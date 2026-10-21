import type { Name } from "../utils/name-parser";

export type WebField = { name: string; component: string };
export type WebFiles = Record<string, string>;

/** A page's executable contract stays in the server setup companion. */
export function pageFiles(name: Name, route: string, interactive = false): WebFiles {
  return {
    [`${name.kebab}.setup.ts`]: `import type { PageConfig } from "@warlock.js/web";

export function loader() {
  return { title: ${JSON.stringify(name.pascal)} };
}

export const config = {
  route: { path: ${JSON.stringify(route)}, name: ${JSON.stringify(route.slice(1).replaceAll("/", ".") || "index")} },
  metadata: { title: ${JSON.stringify(name.pascal)} },
} as const satisfies PageConfig<typeof loader>;
`,
    [`${name.kebab}.page.tsx`]: `import type { PageProps } from "@warlock.js/web";
import type { loader } from "./${name.kebab}.setup";
${interactive ? `import { use${name.pascal} } from "./hooks/use-${name.kebab}";\n` : ""}
export default function ${name.pascal}Page({ data }: PageProps<typeof loader>) {
  ${interactive ? `const { count, increment } = use${name.pascal}();` : ""}
  return <main><h1>{data.title}</h1>${interactive ? '<button type="button" onClick={increment}>Count: {count}</button>' : ""}</main>;
}
`,
    ...(interactive
      ? {
          [`hooks/use-${name.kebab}.ts`]: `import { useState } from "react";

export function use${name.pascal}() {
  const [count, setCount] = useState(0);
  return { count, increment: () => setCount((value) => value + 1) };
}
`,
        }
      : {}),
  };
}

function inputImport(component: string): string {
  const file = component.replace(
    /[A-Z]/g,
    (letter, index) => `${index ? "-" : ""}${letter.toLowerCase()}`,
  );
  return `import ${component} from "web/design-system/components/${file}";`;
}

/** Forms share the same schema value with their controller, with no server imports in the UI. */
export function formFiles(
  name: Name,
  schemaImport: string,
  schemaName: string,
  fields: WebField[],
  endpoint: string,
): WebFiles {
  const components = [...new Set(fields.map((field) => field.component))];
  return {
    [`types/${name.kebab}-form-props.ts`]: `import type { Infer } from "@warlock.js/seal";
import type { ${schemaName} } from "${schemaImport}";

export type ${name.pascal}FormProps = {
  path?: string;
  method?: "POST" | "PUT";
  defaultValue?: Partial<Infer<typeof ${schemaName}>>;
};
`,
    [`hooks/use-${name.kebab}-form.ts`]: `import { useSubmitForm } from "@warlock.js/web/form";
import type { ${schemaName} } from "${schemaImport}";
import type { ${name.pascal}FormProps } from "../types/${name.kebab}-form-props";

export function use${name.pascal}Form({ path = ${JSON.stringify(endpoint)}, method = "POST" }: ${name.pascal}FormProps) {
  return useSubmitForm<typeof ${schemaName}>({ path, method });
}
`,
    [`${name.kebab}-form.tsx`]: `import { Form } from "@mongez/react-form";
${components.map(inputImport).join("\n")}
${inputImport("SubmitButton")}
import { ${schemaName} } from "${schemaImport}";
import { use${name.pascal}Form } from "./hooks/use-${name.kebab}-form";
import type { ${name.pascal}FormProps } from "./types/${name.kebab}-form-props";

export default function ${name.pascal}Form(props: ${name.pascal}FormProps) {
  const { submit, isLoading, formErrors, data } = use${name.pascal}Form(props);
  return <Form schema={${schemaName}} defaultValue={props.defaultValue} onSubmit={submit}>
${fields.map((field) => `    <${field.component} name=${JSON.stringify(field.name)} label=${JSON.stringify(field.name)} />`).join("\n")}
    {formErrors.map((message) => <p role="alert" key={message}>{message}</p>)}
    {data !== null && <p role="status">Saved successfully.</p>}
    <SubmitButton disabled={isLoading}>{isLoading ? "Saving…" : "Save"}</SubmitButton>
  </Form>;
}
`,
  };
}

/** The UI talks to the existing module endpoints, so their authorization remains authoritative. */
export function crudFiles(module: Name, filters: string[]): WebFiles {
  const base = module.plural.kebab;
  const entity = module.singular;
  const files: WebFiles = {
    "types/record.ts": `export type RecordData = { id: string | number; [field: string]: unknown };
export type ListData = { data: RecordData[]; pagination: { page: number; pages: number } };
`,
    "hooks/use-list.ts": `import { http } from "@mongez/http";
import type { FormSubmitOptions } from "@mongez/react-form";
import { useEffect, useState } from "react";
import type { ListData } from "../types/record";

export function useList() {
  const [query, setQuery] = useState<Record<string, string | number>>({ page: 1 });
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const pending = http.get<ListData>("/${base}", { params: query });
    void pending.then((response) => {
      if (!active) { return; }
      if (response.error) { setError(response.error.message); }
      else { setResult(response.data); }
    }).catch(() => { if (active) { setError("Unable to load records."); } })
      .finally(() => { if (active) { setLoading(false); } });
    return () => { active = false; pending.cancel(); };
  }, [query, revision]);
  const filter = ({ values }: FormSubmitOptions) => {
    const next: Record<string, string | number> = { page: 1 };
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string" && value !== "") { next[key] = value; }
    }
    setQuery(next);
  };
  return { result, error, isLoading, filter,
    page: (page: number) => setQuery((value) => ({ ...value, page })),
    refresh: () => setRevision((value) => value + 1) };
}
`,
    "hooks/use-edit.ts": `import { http } from "@mongez/http";
import { useEffect, useState } from "react";
import type { Update${entity.pascal}Schema } from "app/${base}/schema/update-${entity.kebab}.schema";

export function useEdit(id: string) {
  const [record, setRecord] = useState<{ id: string; values: Partial<Update${entity.pascal}Schema> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setRecord(null);
    setError(null);
    const pending = http.get<{ ${entity.camel}: Partial<Update${entity.pascal}Schema> }>(\`/${base}/\${encodeURIComponent(id)}\`);
    void pending.then((response) => {
      if (!active) { return; }
      if (response.error) { setError(response.error.message); }
      else { setRecord({ id, values: response.data.${entity.camel} }); }
    }).catch(() => { if (active) { setError("Unable to load record."); } });
    return () => { active = false; pending.cancel(); };
  }, [id]);
  return { values: record?.id === id ? record.values : null, error };
}
`,
    "hooks/use-delete.ts": `import { useSubmitForm } from "@warlock.js/web/form";

export function useDelete(id: string | number, onDeleted: () => void) {
  return useSubmitForm({ path: \`/${base}/\${encodeURIComponent(id)}\`, method: "DELETE", onSuccess: onDeleted });
}
`,
    "types/delete-action-props.ts": `export type DeleteActionProps = { id: string | number; onDeleted: () => void };
`,
    "delete-action.tsx": `import { Form } from "@mongez/react-form";
import SubmitButton from "web/design-system/components/submit-button";
import { useDelete } from "./hooks/use-delete";
import type { DeleteActionProps } from "./types/delete-action-props";

export default function DeleteAction({ id, onDeleted }: DeleteActionProps) {
  const { submit, isLoading, formErrors } = useDelete(id, onDeleted);
  return <Form onSubmit={submit}>
    {formErrors.map((message) => <p role="alert" key={message}>{message}</p>)}
    <SubmitButton disabled={isLoading}>Delete</SubmitButton>
  </Form>;
}
`,
    "index.page.tsx": `import { Form } from "@mongez/react-form";
${filters.length ? inputImport("TextInput") : ""}
import SubmitButton from "web/design-system/components/submit-button";
import DeleteAction from "./delete-action";
import { useList } from "./hooks/use-list";

export default function ${module.pascal}ListPage() {
  const { result, error, isLoading, filter, page, refresh } = useList();
  return <main><h1>${module.pascal}</h1><a href="/${base}/create">Create</a>
    <Form onSubmit={filter}>
${filters.map((field) => `      <TextInput name=${JSON.stringify(field)} label=${JSON.stringify(field)} />`).join("\n")}
      <SubmitButton>Filter</SubmitButton>
    </Form>
    {error && <p role="alert">{error}</p>}
    {isLoading && <p role="status">Loading…</p>}
    <ul>{result?.data.map((record) => <li key={record.id}>
      <a href={\`/${base}/\${encodeURIComponent(record.id)}/edit\`}>{record.id}</a>
      <DeleteAction id={record.id} onDeleted={refresh} />
    </li>)}</ul>
    <button type="button" disabled={isLoading || !result || result.pagination.page <= 1} onClick={() => page((result?.pagination.page ?? 1) - 1)}>Previous</button>
    <button type="button" disabled={isLoading || !result || result.pagination.page >= result.pagination.pages} onClick={() => page((result?.pagination.page ?? 1) + 1)}>Next</button>
  </main>;
}
`,
    "create.page.tsx": `import Create${entity.pascal}Form from "./create-${entity.kebab}-form";

export default function Create${entity.pascal}Page() {
  return <main><h1>Create ${entity.pascal}</h1><Create${entity.pascal}Form /></main>;
}
`,
    "edit.page.tsx": `import type { PageProps } from "@warlock.js/web";
import type { loader } from "./edit.setup";
import { useEdit } from "./hooks/use-edit";
import Update${entity.pascal}Form from "./update-${entity.kebab}-form";

export default function Edit${entity.pascal}Page({ data }: PageProps<typeof loader>) {
  const { values, error } = useEdit(data.id);
  return <main><h1>Edit ${entity.pascal}</h1>
    {error && <p role="alert">{error}</p>}
    {!values && !error && <p role="status">Loading…</p>}
    {values && <Update${entity.pascal}Form key={data.id} path={\`/${base}/\${encodeURIComponent(data.id)}\`} method="PUT" defaultValue={values} />}
  </main>;
}
`,
  };
  for (const [file, route] of [
    ["index", `/${base}`],
    ["create", `/${base}/create`],
    ["edit", `/${base}/:id/edit`],
  ]) {
    files[`${file}.setup.ts`] =
      `import type { PageConfig${file === "edit" ? ", PageLoaderContext" : ""} } from "@warlock.js/web";
import { requireUser } from "@warlock.js/web/session";

export ${
        file === "edit"
          ? `async function loader({ request }: PageLoaderContext) {
  const id = String(request.input("id"));
  return { id };
}`
          : `function loader() { return {}; }`
      }

export const config = {
  route: { path: "${route}", name: "${base}.${file}" },
  middleware: [requireUser({ userType: "user" })],
  metadata: { title: "${module.pascal}" },
} as const satisfies PageConfig<typeof loader>;
`;
  }
  return files;
}
