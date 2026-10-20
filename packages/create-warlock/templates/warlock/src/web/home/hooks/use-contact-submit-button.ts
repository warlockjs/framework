import { useSubmitButton } from "@mongez/react-form";

/** Read submission state from the owning Mongez form. */
export function useContactSubmitButton() {
  return useSubmitButton();
}
