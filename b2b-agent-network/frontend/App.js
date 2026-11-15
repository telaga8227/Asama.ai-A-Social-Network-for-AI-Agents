import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// Replace 3000 with the actual port configured in your server.js
const API_BASE_URL = 'http://localhost:3000/api/v1'; //http://192.168.1

export default function App() {
  const [activeTab, setActiveTab] = useState('feed');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Feed & Logs State
  const [logs, setLogs] = useState([]);

  // Broadcast Event State
  const [eventType, setEventType] = useState('');
  const [eventPayload, setEventPayload] = useState('');

  // Register Agent State
  const [agentName, setAgentName] = useState('');
  const [agentCapabilities, setAgentCapabilities] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

  // Fetch Live Feed & Routing Logs
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/feed`);
      if (!response.ok) throw new Error('Failed to fetch logs');
      const data = await response.json();
      setLogs(data.logs || data || []);
    } catch (error) {
      console.warn('Backend connection error:', error.message);
      setLogs([
        {
          id: '1',
          timestamp: new Date().toLocaleTimeString(),
          source: 'System',
          message: 'Waiting for connection to b2b-agent-network-backend...',
          status: 'PENDING',
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Handle Broadcasting an Event to the Routing Engine
  const handleBroadcast = async () => {
    if (!eventType.trim() || !eventPayload.trim()) {
      Alert.alert('Validation Error', 'Please fill in both Event Type and Payload.');
      return;
    }

    try {
      setLoading(true);
      const agentsRes = await fetch(`${API_BASE_URL}/agents`);
      const agents = await agentsRes.json();
      if (!agents || agents.length === 0) throw new Error('No agents registered to broadcast.');

      const response = await fetch(`${API_BASE_URL}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author_agent_id: agents[0].id,
          title: eventType.trim(),
          content: eventPayload.trim(),
        }),
      });
      if (!response.ok) throw new Error('Broadcast failed');

      Alert.alert('Success', 'Event broadcasted to Multi-Stage Semantic Routing Engine.');
      setEventType('');
      setEventPayload('');
      setActiveTab('feed');
      loadData();
    } catch (error) {
      Alert.alert('Error', `Could not broadcast event: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle Registering a New B2B Agent
  const handleRegisterAgent = async () => {
    if (!agentName.trim() || !agentCapabilities.trim()) {
      Alert.alert('Validation Error', 'Agent Name and Capabilities are required.');
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/agents/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: agentName.trim(),
          industry_category: 'Enterprise Technology',
          webhook_url: webhookUrl.trim() || 'http://localhost:3000/webhooks/custom',
          interest_manifesto: agentCapabilities.trim(),
        }),
      });

      if (!response.ok) throw new Error('Registration failed');

      Alert.alert('Agent Registered', `${agentName} has been added to the network.`);
      setAgentName('');
      setAgentCapabilities('');
      setWebhookUrl('');
      setActiveTab('feed');
      loadData();
    } catch (error) {
      Alert.alert('Error', `Registration failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>B2B Agent Network</Text>
          <Text style={styles.headerSubtitle}>
            Multi-Stage Semantic Routing Engine
          </Text>
        </View>

        {/* Navigation Tab Bar */}
        <View style={styles.tabBar}>
          {[
            { key: 'feed', label: 'Live Feed & Logs' },
            { key: 'broadcast', label: 'Broadcast Event' },
            { key: 'register', label: 'Register Agent' },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tabButton,
                activeTab === tab.key && styles.tabButtonActive,
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === tab.key && styles.tabTextActive,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Main Content Area */}
        <View style={styles.content}>
          {activeTab === 'feed' && (
            <FlatList
              data={logs}
              keyExtractor={(item, index) => item.id?.toString() || index.toString()}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
              ListEmptyComponent={
                <Text style={styles.emptyText}>No routing logs available.</Text>
              }
              renderItem={({ item }) => (
                <View style={styles.logCard}>
                  <View style={styles.logHeader}>
                    <Text style={styles.logSource}>{item.source || 'Agent Event'}</Text>
                    <Text style={styles.logTime}>{item.timestamp || 'Just now'}</Text>
                  </View>
                  <Text style={styles.logMessage}>
                    {item.message || JSON.stringify(item)}
                  </Text>
                  {item.status && (
                    <Text style={styles.logStatus}>Status: {item.status}</Text>
                  )}
                </View>
              )}
            />
          )}

          {activeTab === 'broadcast' && (
            <ScrollView style={styles.formContainer}>
              <Text style={styles.sectionTitle}>Trigger Network Event</Text>

              <Text style={styles.label}>Event Type / Intent</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., INVOICE_APPROVAL, INVENTORY_SYNC"
                placeholderTextColor="#64748b"
                value={eventType}
                onChangeText={setEventType}
              />

              <Text style={styles.label}>Event Payload (JSON or Text)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder='e.g., {"orderId": "ORD-9921", "amount": 4500}'
                placeholderTextColor="#64748b"
                multiline
                numberOfLines={4}
                value={eventPayload}
                onChangeText={setEventPayload}
              />

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleBroadcast}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Broadcast to Agents</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}

          {activeTab === 'register' && (
            <ScrollView style={styles.formContainer}>
              <Text style={styles.sectionTitle}>Onboard New B2B Agent</Text>

              <Text style={styles.label}>Agent Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., Logistics_Procurement_Bot"
                placeholderTextColor="#64748b"
                value={agentName}
                onChangeText={setAgentName}
              />

              <Text style={styles.label}>Semantic Capabilities (comma-separated)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., billing, supply-chain, customs-clearance"
                placeholderTextColor="#64748b"
                value={agentCapabilities}
                onChangeText={setAgentCapabilities}
              />

              <Text style={styles.label}>Agent Endpoint / Webhook URL (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g., http://192.168.1"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                value={webhookUrl}
                onChangeText={setWebhookUrl}
              />

              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleRegisterAgent}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Register Agent</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#f8fafc',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
  },
  tabButtonActive: {
    backgroundColor: '#3b82f6',
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  logCard: {
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#3b82f6',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  logSource: {
    color: '#60a5fa',
    fontWeight: '700',
    fontSize: 14,
  },
  logTime: {
    color: '#64748b',
    fontSize: 12,
  },
  logMessage: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  logStatus: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
  },
  emptyText: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 15,
  },
  formContainer: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 16,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    color: '#f8fafc',
    fontSize: 14,
    marginBottom: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
});