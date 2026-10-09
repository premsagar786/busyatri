import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";

const KEY = "busyatri_api";

// Effective API base URL. The QR scan can override the baked-in
// EXPO_PUBLIC_API_URL (tunnel URLs change; rebuilding the app for that is
// silly). Manual login uses whatever is stored, else the baked default.
export async function getApiUrl(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(KEY)) || API_URL;
  } catch {
    return API_URL;
  }
}

export async function setApiUrl(url: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, url);
  } catch (err) {
    console.error("[endpoint] save failed", err);
  }
}
