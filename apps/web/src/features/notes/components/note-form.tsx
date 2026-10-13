import { CreateNoteInput } from '@atlas/shared';
import { Button, Field, Input, makeStyles, Textarea, tokens } from '@fluentui/react-components';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { ErrorMessage } from '@/components/error-message';
import { ApiError } from '@/lib/api-client';
import { useCreateNote } from '../api/use-notes';

type FieldErrors = Partial<Record<keyof CreateNoteInput, string>>;

const useStyles = makeStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    marginBlock: tokens.spacingVerticalL,
  },
});

/** Creates a note. Validates with the API's own schema before sending anything. */
export function NoteForm() {
  const styles = useStyles();
  const createNote = useCreateNote();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    createNote.reset();
    // The schema the API validates with, so most mistakes never leave the browser.
    const parsed = CreateNoteInput.safeParse({ title, body });
    if (!parsed.success) {
      const { fieldErrors: errors } = z.flattenError(parsed.error);
      setFieldErrors({ title: errors.title?.[0], body: errors.body?.[0] });
      return;
    }
    setFieldErrors({});
    createNote.mutate(parsed.data, {
      onSuccess: () => {
        setTitle('');
        setBody('');
      },
      onError: (error) => {
        if (error instanceof ApiError) setFieldErrors(fieldErrorsFrom(error));
      },
    });
  }

  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <Field label="Title" required validationMessage={fieldErrors.title}>
        <Input
          value={title}
          onChange={(_, data) => {
            setTitle(data.value);
          }}
        />
      </Field>
      <Field label="Body" validationMessage={fieldErrors.body}>
        <Textarea
          value={body}
          onChange={(_, data) => {
            setBody(data.value);
          }}
        />
      </Field>
      {createNote.isError && !hasFieldErrors && <ErrorMessage error={createNote.error} />}
      <div>
        <Button type="submit" appearance="primary" disabled={createNote.isPending}>
          Add note
        </Button>
      </div>
    </form>
  );
}

/** Field errors from a 400 problem, keyed by the fields this form has. */
function fieldErrorsFrom(error: ApiError): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of error.problem.errors ?? []) {
    if (path === 'title' || path === 'body') errors[path] ??= message;
  }
  return errors;
}
