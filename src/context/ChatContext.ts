import { logger } from '../utils/logger';
import {
  ContextItem,
  ContextType,
  ContextSource,
  ContextPriority,
  ChatMetadata,
  ConversationTurn
} from './types';
import { ChromaContextDB } from './storage/ChromaContextDB';
import { BaseMessage } from '@langchain/core/messages';

/**
 * Manages chat/conversation context including dialogue flow, intent tracking,
 * and conversational memory for maintaining coherent interactions
 */
export class ChatContext {
  private contextDB: ChromaContextDB;
  private activeChatSessions: Map<string, ChatSession> = new Map();
  private initialized = false;

  constructor(contextDB: ChromaContextDB) {
    this.contextDB = contextDB;
  }

  /**
   * Initialize chat context system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('[CHAT_CONTEXT] Already initialized');
      return;
    }

    try {
      logger.info('[CHAT_CONTEXT] Initializing chat context system...');
      
      // Load active chat sessions from storage
      await this.loadActiveSessions();
      
      this.initialized = true;
      logger.info('[CHAT_CONTEXT] Chat context system initialized');

    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Start a new chat session
   */
  public async startChatSession(sessionId: string, chatId?: string): Promise<string> {
    try {
      const actualChatId = chatId || this.generateChatId();
      
      logger.debug(`[CHAT_CONTEXT] Starting chat session: ${actualChatId} (session: ${sessionId})`);

      const chatSession = new ChatSession(actualChatId, sessionId);
      this.activeChatSessions.set(actualChatId, chatSession);

      // Store initial metadata
      await this.contextDB.storeChatMetadata({
        chatId: actualChatId,
        sessionId,
        messageCount: 0,
        participants: ['user', 'assistant'],
        lastActivity: new Date(),
        conversationFlow: []
      });

      return actualChatId;

    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to start chat session:', error);
      throw error;
    }
  }

  /**
   * Add message to chat context
   */
  public async addMessage(chatId: string, message: BaseMessage, intent?: string, entities?: Record<string, any>): Promise<void> {
    try {
      const chatSession = this.activeChatSessions.get(chatId);
      if (!chatSession) {
        logger.warn(`[CHAT_CONTEXT] Chat session not found: ${chatId}`);
        return;
      }

      logger.debug(`[CHAT_CONTEXT] Adding message to chat ${chatId}: ${message._getType()}`);

      // Add to session
      const turn = chatSession.addMessage(message, intent, entities);

      // Store as context item for retrieval
      const contextItem: ContextItem = {
        id: `chat_msg_${turn.id}`,
        type: ContextType.CHAT,
        source: ContextSource.CONVERSATION,
        content: message.content.toString(),
        metadata: {
          role: message._getType(),
          intent: intent || null,
          entities: entities || {},
          turnId: turn.id,
          messageIndex: chatSession.getMessageCount()
        },
        relevanceScore: this.calculateMessageRelevance(message, chatSession),
        priority: ContextPriority.MEDIUM,
        timestamp: new Date(),
        tags: this.extractMessageTags(message, intent),
        chatId,
        sessionId: chatSession.sessionId
      };

      await this.contextDB.store(contextItem);

      // Update chat metadata
      await this.updateChatMetadata(chatSession);

      // Check for topic evolution
      await this.analyzeTopicEvolution(chatSession);

    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to add message:', error);
      throw error;
    }
  }

  /**
   * Get conversation context for a chat session
   */
  public async getConversationContext(chatId: string, maxMessages?: number): Promise<ContextItem[]> {
    try {
      logger.debug(`[CHAT_CONTEXT] Getting conversation context for chat: ${chatId}`);

      const contextItems = await this.contextDB.search({
        query: '',
        types: [ContextType.CHAT],
        chatId,
        maxResults: maxMessages || 20
      });

      // Sort by timestamp to maintain conversation order
      return contextItems.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to get conversation context:', error);
      return [];
    }
  }

  /**
   * Analyze conversation for patterns and insights
   */
  public async analyzeConversation(chatId: string): Promise<any> {
    try {
      const chatSession = this.activeChatSessions.get(chatId);
      if (!chatSession) {
        logger.warn(`[CHAT_CONTEXT] Chat session not found for analysis: ${chatId}`);
        return null;
      }

      logger.debug(`[CHAT_CONTEXT] Analyzing conversation: ${chatId}`);

      const analysis = {
        messageCount: chatSession.getMessageCount(),
        averageMessageLength: chatSession.getAverageMessageLength(),
        topicProgression: chatSession.getTopicProgression(),
        intentDistribution: chatSession.getIntentDistribution(),
        entityMentions: chatSession.getEntityMentions(),
        conversationDuration: chatSession.getDuration(),
        userEngagement: this.calculateUserEngagement(chatSession),
        coherenceScore: this.calculateCoherenceScore(chatSession)
      };

      return analysis;

    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to analyze conversation:', error);
      return null;
    }
  }

  /**
   * Add context item to chat context
   */
  public async addContext(item: ContextItem): Promise<void> {
    try {
      logger.debug(`[CHAT_CONTEXT] Adding context item: ${item.id}`);
      await this.contextDB.store(item);
    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to add context:', error);
      throw error;
    }
  }

  /**
   * End a chat session
   */
  public async endChatSession(chatId: string): Promise<void> {
    try {
      logger.debug(`[CHAT_CONTEXT] Ending chat session: ${chatId}`);

      const chatSession = this.activeChatSessions.get(chatId);
      if (chatSession) {
        // Final metadata update
        await this.updateChatMetadata(chatSession);
        
        // Store conversation summary
        await this.storeConversationSummary(chatSession);
        
        // Remove from active sessions
        this.activeChatSessions.delete(chatId);
      }

    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to end chat session:', error);
      throw error;
    }
  }

  /**
   * Get chat context statistics
   */
  public async getStats(): Promise<any> {
    try {
      const activeSessions = this.activeChatSessions.size;
      const totalMessages = Array.from(this.activeChatSessions.values())
        .reduce((sum, session) => sum + session.getMessageCount(), 0);

      return {
        activeSessions,
        totalMessages,
        averageSessionLength: activeSessions > 0 ? totalMessages / activeSessions : 0,
        initialized: this.initialized
      };
    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to get stats:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async loadActiveSessions(): Promise<void> {
    // Implementation would load recent active sessions from database
    // For now, we start fresh each time
    logger.debug('[CHAT_CONTEXT] Loading active sessions (starting fresh)');
  }

  private generateChatId(): string {
    return `chat_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private calculateMessageRelevance(message: BaseMessage, session: ChatSession): number {
    // Simple relevance calculation based on message type and recency
    const baseScore = message._getType() === 'human' ? 0.8 : 0.7;
    const recencyBoost = 1.0; // Recent messages are more relevant
    return Math.min(baseScore * recencyBoost, 1.0);
  }

  private extractMessageTags(message: BaseMessage, intent?: string): string[] {
    const tags: string[] = [];
    
    tags.push(message._getType());
    
    if (intent) {
      tags.push(`intent:${intent}`);
    }
    
    // Extract simple keyword tags from content
    const content = message.content.toString().toLowerCase();
    if (content.includes('error') || content.includes('problem')) {
      tags.push('error');
    }
    if (content.includes('help') || content.includes('how')) {
      tags.push('help');
    }
    if (content.includes('code') || content.includes('function')) {
      tags.push('code');
    }
    
    return tags;
  }

  private async updateChatMetadata(session: ChatSession): Promise<void> {
    try {
      await this.contextDB.storeChatMetadata({
        chatId: session.chatId,
        sessionId: session.sessionId,
        messageCount: session.getMessageCount(),
        participants: ['user', 'assistant'],
        topic: session.getCurrentTopic(),
        lastActivity: new Date(),
        conversationFlow: session.getConversationFlow()
      });
    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to update chat metadata:', error);
    }
  }

  private async analyzeTopicEvolution(session: ChatSession): Promise<void> {
    // Implementation would analyze if the conversation topic has shifted
    // and update topic tracking accordingly
    logger.debug(`[CHAT_CONTEXT] Analyzing topic evolution for: ${session.chatId}`);
  }

  private calculateUserEngagement(session: ChatSession): number {
    // Simple engagement calculation based on message frequency and length
    const messageCount = session.getMessageCount();
    const avgLength = session.getAverageMessageLength();
    const duration = session.getDuration();
    
    if (duration === 0) return 0;
    
    const messagesPerMinute = messageCount / (duration / 60000);
    return Math.min(messagesPerMinute * avgLength / 100, 1.0);
  }

  private calculateCoherenceScore(session: ChatSession): number {
    // Simple coherence calculation - could be enhanced with NLP
    const flow = session.getConversationFlow();
    if (flow.length < 2) return 1.0;
    
    // For now, return a placeholder score
    return 0.8;
  }

  private async storeConversationSummary(session: ChatSession): Promise<void> {
    try {
      const summary = await this.generateConversationSummary(session);
      
      const contextItem: ContextItem = {
        id: `conversation_summary_${session.chatId}`,
        type: ContextType.CHAT,
        source: ContextSource.CONVERSATION,
        content: summary,
        metadata: {
          chatId: session.chatId,
          messageCount: session.getMessageCount(),
          duration: session.getDuration(),
          topic: session.getCurrentTopic()
        },
        relevanceScore: 0.9,
        priority: ContextPriority.HIGH,
        timestamp: new Date(),
        tags: ['summary', 'conversation'],
        chatId: session.chatId,
        sessionId: session.sessionId
      };

      await this.contextDB.store(contextItem);
      
    } catch (error) {
      logger.error('[CHAT_CONTEXT] Failed to store conversation summary:', error);
    }
  }

  private async generateConversationSummary(session: ChatSession): Promise<string> {
    // Generate a simple summary of the conversation
    const flow = session.getConversationFlow();
    const messageCount = session.getMessageCount();
    const topic = session.getCurrentTopic();
    
    return `Conversation summary: ${messageCount} messages exchanged${topic ? ` about ${topic}` : ''}. Duration: ${Math.round(session.getDuration() / 60000)} minutes.`;
  }
}

/**
 * Individual chat session tracking conversation state
 */
class ChatSession {
  public chatId: string;
  public sessionId: string;
  private messages: ConversationTurn[] = [];
  private startTime: Date = new Date();
  private topics: string[] = [];
  private intents: Map<string, number> = new Map();
  private entities: Map<string, any[]> = new Map();

  constructor(chatId: string, sessionId: string) {
    this.chatId = chatId;
    this.sessionId = sessionId;
  }

  public addMessage(message: BaseMessage, intent?: string, entities?: Record<string, any>): ConversationTurn {
    const turn: ConversationTurn = {
      id: `turn_${Date.now()}_${this.messages.length}`,
      role: this.mapMessageRole(message._getType()),
      content: message.content.toString(),
      timestamp: new Date(),
      intent,
      entities,
      references: []
    };

    this.messages.push(turn);

    // Track intents
    if (intent) {
      this.intents.set(intent, (this.intents.get(intent) || 0) + 1);
    }

    // Track entities
    if (entities) {
      Object.entries(entities).forEach(([key, value]) => {
        if (!this.entities.has(key)) {
          this.entities.set(key, []);
        }
        this.entities.get(key)!.push(value);
      });
    }

    return turn;
  }

  public getMessageCount(): number {
    return this.messages.length;
  }

  public getAverageMessageLength(): number {
    if (this.messages.length === 0) return 0;
    const totalLength = this.messages.reduce((sum, msg) => sum + msg.content.length, 0);
    return totalLength / this.messages.length;
  }

  public getDuration(): number {
    return Date.now() - this.startTime.getTime();
  }

  public getCurrentTopic(): string | undefined {
    return this.topics.length > 0 ? this.topics[this.topics.length - 1] : undefined;
  }

  public getTopicProgression(): string[] {
    return [...this.topics];
  }

  public getIntentDistribution(): Record<string, number> {
    return Object.fromEntries(this.intents);
  }

  public getEntityMentions(): Record<string, any[]> {
    return Object.fromEntries(this.entities);
  }

  public getConversationFlow(): ConversationTurn[] {
    return [...this.messages];
  }

  private mapMessageRole(messageType: string): 'user' | 'assistant' | 'system' {
    switch (messageType) {
      case 'human': return 'user';
      case 'ai': return 'assistant';
      case 'system': return 'system';
      default: return 'user';
    }
  }
}