import axios from "axios";
import { getValidAccessToken } from "./tokenStore";

const ML_API_BASE = "https://api.mercadolibre.com";

export interface MlQuestion {
  id: number;
  item_id: string;
  seller_id: number;
  status: string;
  text: string;
  date_created: string;
  from: { id: number };
}

interface MlQuestionSearchResponse {
  questions: MlQuestion[];
  total: number;
}

export async function searchPendingQuestions(lojaId: number, sellerMlUserId: number): Promise<MlQuestion[]> {
  const accessToken = await getValidAccessToken(lojaId);
  const { data } = await axios.get<MlQuestionSearchResponse>(`${ML_API_BASE}/questions/search`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      seller_id: sellerMlUserId,
      status: "UNANSWERED",
      sort_fields: "date_created",
      sort_types: "DESC",
    },
  });
  return data.questions;
}

export async function getUserNicknames(lojaId: number, userIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) return result;

  const accessToken = await getValidAccessToken(lojaId);
  await Promise.all(
    uniqueIds.map(async (userId) => {
      try {
        const { data } = await axios.get<{ nickname: string }>(`${ML_API_BASE}/users/${userId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        result.set(userId, data.nickname);
      } catch {
        result.set(userId, `Usuário ${userId}`);
      }
    })
  );

  return result;
}

export async function answerQuestion(lojaId: number, questionId: number, text: string): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  await axios.post(
    `${ML_API_BASE}/answers`,
    { question_id: questionId, text },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
}

export async function deleteQuestion(lojaId: number, questionId: number): Promise<void> {
  const accessToken = await getValidAccessToken(lojaId);
  await axios.delete(`${ML_API_BASE}/questions/${questionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
