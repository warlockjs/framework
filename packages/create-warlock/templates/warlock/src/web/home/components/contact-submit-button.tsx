import { useContactSubmitButton } from "../hooks/use-contact-submit-button";
import type { ContactSubmitButtonProps } from "../types/contact-controls.type";

export default function ContactSubmitButton({
  idleLabel,
  submittingLabel,
}: ContactSubmitButtonProps) {
  const { disabled, isSubmitting } = useContactSubmitButton();

  return (
    <button className="warlock-contact-submit" type="submit" disabled={disabled}>
      {isSubmitting ? submittingLabel : idleLabel}
      <span aria-hidden="true">→</span>
    </button>
  );
}
