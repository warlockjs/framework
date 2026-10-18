const dirtyForms = new Set<object>();
const listeners = new Set<() => void>();

export function hasDirtyForms(): boolean {
  return dirtyForms.size > 0;
}

export function setFormDirty(form: object, dirty: boolean): void {
  const previous = hasDirtyForms();
  if (dirty) dirtyForms.add(form);
  else dirtyForms.delete(form);
  if (previous !== hasDirtyForms()) for (const listener of listeners) listener();
}

export function subscribeDirtyForms(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Values of editable controls, including unnamed controls and unchecked boxes. */
export function formInputSnapshot(form: HTMLFormElement): string {
  return JSON.stringify(
    Array.from(form.elements).map((element): unknown => {
      if (element instanceof HTMLInputElement) {
        if (["hidden", "submit", "button", "reset", "image"].includes(element.type)) return null;
        return [
          element.name,
          element.value,
          element.checked,
          Array.from(element.files ?? []).map((file) => [file.name, file.size, file.lastModified]),
        ];
      }
      if (element instanceof HTMLTextAreaElement) return [element.name, element.value];
      if (element instanceof HTMLSelectElement) {
        return [element.name, Array.from(element.selectedOptions).map((option) => option.value)];
      }
      return null;
    }),
  );
}
