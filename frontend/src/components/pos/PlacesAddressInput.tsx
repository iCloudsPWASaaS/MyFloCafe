'use client';

import { useEffect, useRef } from 'react';

interface PlacesAddressInputProps {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

interface PlacesAutocomplete {
  addListener(event: 'place_changed', handler: () => void): void;
  getPlace(): { formatted_address?: string };
}

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (input: HTMLInputElement, options: { fields: string[] }) => PlacesAutocomplete;
        };
      };
    };
    initFloCafePlaces?: () => void;
  }
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const SCRIPT_TIMEOUT_MS = 10_000;

let placesScriptPromise: Promise<void> | null = null;

function loadPlacesScript(): Promise<void> {
  if (API_KEY === '') return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured'));
  if (placesScriptPromise) return placesScriptPromise;
  placesScriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined' || window.google?.maps?.places) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(
      () => reject(new Error('Google Maps API did not call initFloCafePlaces (check the browser console for Maps API errors)')),
      SCRIPT_TIMEOUT_MS,
    );
    window.initFloCafePlaces = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}&libraries=places&loading=async&callback=initFloCafePlaces`;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Failed to load Google Maps script (CSP or network blocked it)'));
    };
    document.head.appendChild(script);
  });
  return placesScriptPromise;
}

export default function PlacesAddressInput({ value, onChange, placeholder, className, ...rest }: PlacesAddressInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!inputRef.current) return;
    let autocomplete: PlacesAutocomplete | null = null;
    let cancelled = false;

    console.info(
      `[PlacesAddressInput] mounting - API key ${API_KEY ? 'configured' : 'NOT configured (plain text fallback)'}`,
    );

    loadPlacesScript()
      .then(() => {
        if (cancelled || !inputRef.current || !window.google?.maps?.places) return;
        autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, { fields: ['formatted_address'] });
        const style = document.createElement('style');
        style.textContent = '.pac-container { z-index: 100000 !important; }';
        document.head.appendChild(style);
        autocomplete.addListener('place_changed', () => {
          const address = autocomplete?.getPlace().formatted_address;
          if (typeof address === 'string' && address.length > 0) {
            console.info('[PlacesAddressInput] selected:', address);
            onChangeRef.current(address);
          }
        });
        console.info('[PlacesAddressInput] Places autocomplete attached');
      })
      .catch((err: unknown) => {
        // No API key, offline, or Google rejected the key (CSP/billing/referrer):
        // the field stays a plain text input. Surface the reason so a misconfigured
        // key is diagnosable from the DevTools console instead of failing silently.
        console.warn('[PlacesAddressInput] Places autocomplete unavailable:', err instanceof Error ? err.message : err);
      });

    return () => {
      cancelled = true;
      autocomplete = null;
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      {...rest}
    />
  );
}