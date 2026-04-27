import { Check } from "lucide-react";

export type StepperStage = "confirm" | "processing" | "success" | "failed";

interface Step {
  key: StepperStage;
  label: string;
}

const STEPS: Step[] = [
  { key: "confirm", label: "Confirm" },
  { key: "processing", label: "Processing" },
  { key: "success", label: "Success" },
];

function indexOf(stage: StepperStage): number {
  if (stage === "confirm") return 0;
  if (stage === "processing") return 1;
  return 2; // success or failed both occupy the final slot
}

/**
 * Three-step payment progress indicator. Renders the same way for `success`
 * and `failed` (final slot) but tints the connector + final dot red on
 * `failed` to make the terminal failure obvious without changing layout.
 */
export function PaymentStepper({ stage }: { stage: StepperStage }) {
  const active = indexOf(stage);
  const failed = stage === "failed";

  return (
    <ol className="ps-stepper" role="list" aria-label="Payment progress">
      {STEPS.map((step, i) => {
        const done = i < active;
        const current = i === active;
        const isFinal = i === STEPS.length - 1;
        const dotState =
          failed && isFinal
            ? "ps-dot-failed"
            : done
              ? "ps-dot-done"
              : current
                ? "ps-dot-current"
                : "ps-dot-pending";
        return (
          <li key={step.key} className="ps-step">
            <div className="ps-step-row">
              <span className={`ps-dot ${dotState}`} aria-current={current ? "step" : undefined}>
                {done && !failed ? (
                  <Check className="w-3 h-3" strokeWidth={3} />
                ) : failed && isFinal ? (
                  <span className="ps-dot-x">×</span>
                ) : (
                  <span className="ps-dot-num">{i + 1}</span>
                )}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={`ps-connector ${
                    i < active ? (failed && i === active - 1 ? "ps-connector-failed" : "ps-connector-done") : "ps-connector-pending"
                  }`}
                />
              )}
            </div>
            <span className={`ps-label ${current ? "ps-label-current" : ""} ${failed && isFinal ? "ps-label-failed" : ""}`}>
              {failed && isFinal ? "Failed" : step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
