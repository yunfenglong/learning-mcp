import type { Conversation, ConversationDetail } from "./models.js";
type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export declare function listConversations(call: Call, userid: number, baseUrl: string, limit: number, offset: number): Promise<Conversation[]>;
export declare function getConversation(call: Call, userid: number, baseUrl: string, id: number, limit: number, offset: number): Promise<ConversationDetail>;
export declare function sendMessage(call: Call, id: number, text: string, user: boolean): Promise<number>;
export declare function markConversationRead(call: Call, userid: number, id: number): Promise<void>;
export {};
