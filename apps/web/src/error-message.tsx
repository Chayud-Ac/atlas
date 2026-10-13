import { MessageBar, MessageBarBody, MessageBarTitle } from '@fluentui/react-components';
import { ApiError } from './api.js';

/**
 * A failed request. Only API problem details are shown: other errors may hold
 * internals. The reference is the API's request id, which finds the log lines.
 */
export function ErrorMessage({ error }: { error: Error }) {
  const isApiError = error instanceof ApiError;
  const reference = isApiError ? error.problem.requestId : undefined;
  return (
    <MessageBar intent="error">
      <MessageBarBody>
        <MessageBarTitle>Something went wrong</MessageBarTitle>
        {isApiError ? error.message : 'Please try again.'}
        {reference && ` (reference ${reference})`}
      </MessageBarBody>
    </MessageBar>
  );
}
