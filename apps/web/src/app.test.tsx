import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './app.js';

describe('App', () => {
  it('shows the app name', () => {
    render(<App />);
    expect(screen.getByText('Atlas')).toBeInTheDocument();
  });
});
