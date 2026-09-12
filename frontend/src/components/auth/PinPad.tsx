'use client';

import { useEffect, useState } from 'react';
import TouchNumberPad from '@/components/pos/TouchNumberPad';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PinPadProps {
  onSubmit: (pin: string) => void;
  loading: boolean;
  pinLabel: string;
  clearLabel: string;
  backspaceLabel: string;
  submitLabel: string;
  error?: string | null;
  maxLength?: number;
}

export default function PinPad({
  onSubmit,
  loading,
  pinLabel,
  clearLabel,
  backspaceLabel,
  submitLabel,
  error,
  maxLength = 6,
}: PinPadProps) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    // A failed attempt leaves the dots filled; clear them so the user
    // starts fresh on the next attempt.
    if (error) setPin('');
  }, [error]);

  const handleChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, maxLength);
    setPin(digits);
  };

  const canSubmit = pin.length >= 4 && pin.length <= maxLength;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium text-muted-foreground">{pinLabel}</span>
        <div className="flex items-center justify-center gap-3 py-3" aria-live="polite">
          {Array.from({ length: maxLength }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-3.5 w-3.5 rounded-full border transition-colors',
                i < pin.length ? 'bg-primary' : 'border-border bg-muted'
              )}
            />
          ))}
        </div>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
      </div>

      <TouchNumberPad
        value={pin}
        onChange={handleChange}
        ariaLabel={pinLabel}
        clearLabel={clearLabel}
        backspaceLabel={backspaceLabel}
        allowDecimal={false}
      />

      <Button
        type="button"
        onClick={() => onSubmit(pin)}
        disabled={loading || !canSubmit}
        className="w-full"
        size="lg"
      >
        {submitLabel}
      </Button>
    </div>
  );
}
