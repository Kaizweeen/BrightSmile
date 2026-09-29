"use client";

import { useQuery } from "@tanstack/react-query";
import type { OperatingHours } from "@/db/schema";
import { api } from "./fetcher";

export type Branch = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  operatingHours: OperatingHours;
  active: boolean;
  sort: number;
  chairCount: number;
};

export type Dentist = { id: string; name: string; title: string | null; branchIds: string[] };

export type PracticeSettings = { name: string; visitMinutes: number; cleaningMinutes: number; onlineBooking: boolean; privacyNotice: string };

export const useBranches = () => useQuery({ queryKey: ["branches"], queryFn: () => api<Branch[]>("/branches") });

export const useDentists = () => useQuery({ queryKey: ["dentists"], queryFn: () => api<Dentist[]>("/dentists") });

export const usePractice = () => useQuery({ queryKey: ["practice"], queryFn: () => api<PracticeSettings>("/practice") });
