import { IconSymbol } from "../components/IconSymbol";
import type { AgentController, AgentMessage } from "./contracts";
import styles from "./ClarificationCard.module.css";

type Clarification = NonNullable<AgentMessage["clarifications"]>[number];

export function ClarificationCard({
  question,
  answers,
  onAnswers,
  controller,
}: {
  question: Clarification;
  answers: Record<string, string[]>;
  onAnswers: (questionId: string, values: string[]) => void;
  controller: AgentController;
}) {
  const interactionId = String(question.interactionId || "");
  const questions = question.questions || [];
  return (
    <section className={styles.card}>
      <header className={styles.head}>
        <IconSymbol name="help" />
        <strong>Agent 需要补充信息</strong>
        {question.expired && <small>已过期</small>}
      </header>
      {questions.map((entry, index) => {
        const questionId = String(entry.id || `question-${index + 1}`);
        const selected = answers[questionId] || [];
        return (
          <div key={questionId} className={styles.question}>
            {entry.header && <small className={styles.label}>{entry.header}</small>}
            <p className={styles.title}>{entry.question || "需要补充信息"}</p>
            <div className={styles.options}>
              {entry.options?.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected.includes(option)}
                  onClick={() =>
                    onAnswers(
                      questionId,
                      entry.multiple
                        ? selected.includes(option)
                          ? selected.filter((value) => value !== option)
                          : [...selected, option]
                        : [option],
                    )
                  }
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <footer className={styles.actions}>
        {!questions.some((entry) => entry.required) && (
          <button
            type="button"
            onClick={() =>
              controller.submitClarification({ interactionId, skipped: true, answers: [] })
            }
          >
            跳过
          </button>
        )}
        <button
          type="button"
          className={styles.submit}
          onClick={() =>
            controller.submitClarification({
              interactionId,
              answers: Object.entries(answers).map(([questionId, values]) => ({
                questionId,
                values,
              })),
            })
          }
        >
          提交回答
        </button>
      </footer>
    </section>
  );
}
