'use client';

import { create } from 'zustand';
import api from '@/lib/api';

export interface CurrentShift {
  id: number;
  opened_at: string;
  opened_by: string;
  opening_cash: number;
  status: 'open';
}

interface ShiftStoreState {
  shift: CurrentShift | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  setShift: (shift: CurrentShift | null) => void;
}

/**
 * Single source of truth for the currently open shift, shared by the POS
 * gate (blocks the register until a shift is opened) and the topbar button
 * (opens/closes it). Keeping both readers on one store prevents the button
 * closing a shift while the gate still thinks one is open.
 */
export const useShiftStore = create<ShiftStoreState>((set) => ({
  shift: null,
  loaded: false,
  refresh: async () => {
    try {
      const { data } = await api.get('/shifts/current');
      set({ shift: (data?.shift ?? null) as CurrentShift | null, loaded: true });
    } catch {
      set({ shift: null, loaded: true });
    }
  },
  setShift: (shift) => set({ shift }),
}));