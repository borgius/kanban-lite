import { useTheme } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { useCallback, useEffect } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useSessionController } from '../../src/features/auth/session-store'
import {
  useVisibleWorkfeed,
  type VisibleTaskPreview,
  type VisibleWorkfeedSection,
} from '../../src/features/tasks/useVisibleWorkfeed'

function findTaskById(tasks: VisibleTaskPreview[], taskId: string | null): VisibleTaskPreview | null {
  if (!taskId) {
    return null
  }

  return tasks.find((task) => task.id === taskId) ?? null
}

function renderBadgeText(task: VisibleTaskPreview): string[] {
  const badges: string[] = []

  if (task.dueBucket === 'overdue') {
    badges.push('Overdue')
  } else if (task.dueBucket === 'today') {
    badges.push('Due today')
  } else if (task.dueBucket === 'next') {
    badges.push('Due next')
  }

  if (task.preview.checklist) {
    badges.push(
      `${task.preview.checklist.completed}/${task.preview.checklist.total} checklist`,
    )
  }

  if (task.preview.forms > 0) {
    badges.push(`${task.preview.forms} form${task.preview.forms === 1 ? '' : 's'}`)
  }

  if (task.preview.attachments > 0) {
    badges.push(
      `${task.preview.attachments} attachment${task.preview.attachments === 1 ? '' : 's'}`,
    )
  }

  if (task.preview.comments > 0) {
    badges.push(`${task.preview.comments} comment${task.preview.comments === 1 ? '' : 's'}`)
  }

  if (task.unread) {
    badges.push('Unread')
  }

  return badges
}

function SectionBlock({
  colors,
  onTaskPress,
  sections,
}: {
  colors: {
    border: string
    card: string
    primary: string
    text: string
  }
  onTaskPress: (task: VisibleTaskPreview) => void
  sections: VisibleWorkfeedSection[]
}) {
  return sections.map((section) => (
    <View key={section.key} style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
        <Text style={[styles.sectionCount, { color: colors.primary }]}>{section.count}</Text>
      </View>
      <View style={styles.cardList}>
        {section.tasks.map((task) => (
          <Pressable
            key={`${section.key}:${task.id}`}
            onPress={() => onTaskPress(task)}
            style={({ pressed }) => [
              styles.taskCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.92 : 1,
              },
            ]}
          >
            <View style={styles.taskCardHeader}>
              <Text style={[styles.taskTitle, { color: colors.text }]}>{task.title}</Text>
              <Text style={[styles.taskStatus, { color: colors.primary }]}>{task.status}</Text>
            </View>
            <Text style={[styles.taskMeta, { color: colors.text }]}>
              {task.site ?? 'No site'} • {task.assignee ?? 'Unassigned'}
            </Text>
            <View style={styles.badgeRow}>
              {renderBadgeText(task).map((badge) => (
                <View key={`${task.id}:${badge}`} style={[styles.badge, { borderColor: colors.border }]}>
                  <Text style={[styles.badgeText, { color: colors.text }]}>{badge}</Text>
                </View>
              ))}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  ))
}

export default function HomeScreen() {
  const { colors } = useTheme()
  const router = useRouter()
  const { controller, state } = useSessionController()
  const onProtectedError = useCallback(async (status: 401 | 403) => {
    await controller.logout({ reason: 'session-revoked', status })
  }, [controller])
  const workfeed = useVisibleWorkfeed({
    authState: state,
    onProtectedError,
  })
  const activeTask = findTaskById(workfeed.tasks, workfeed.landing.activeTaskId)
  const isBusy = state.phase === 'restoring' || state.phase === 'signing-in'
  const openTask = useCallback((task: VisibleTaskPreview) => {
    controller.clearPendingTarget()
    router.push(`/tasks/${encodeURIComponent(task.id)}`)
  }, [controller, router])

  useEffect(() => {
    if (workfeed.landing.status !== 'ready' || workfeed.source !== 'live' || !activeTask) {
      return
    }

    controller.clearPendingTarget()
    router.replace(`/tasks/${encodeURIComponent(activeTask.id)}`)
  }, [activeTask, controller, router, workfeed.landing.status, workfeed.source])

  const cacheBanner = workfeed.source === 'cache'
    ? {
        body:
          workfeed.phase === 'loading'
            ? 'Showing the last validated snapshot while live visibility is checked again. Pending links stay parked until that finishes.'
            : workfeed.errorMessage
              ?? 'You are viewing read-only cached work. Reconnect and retry to confirm the latest visibility.',
        title: workfeed.phase === 'loading' ? 'Refreshing cached work' : 'Showing cached work',
      }
    : null

  if (!state.isProtectedReady || workfeed.phase === 'blocked' || isBusy) {
    return (
      <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}> 
        <View style={[styles.neutralShell, { backgroundColor: colors.card, borderColor: colors.border }]}> 
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.neutralTitle, { color: colors.text }]}>
            {state.statusMessage ?? 'Checking session…'}
          </Text>
          <Text style={[styles.neutralBody, { color: colors.text }]}>
            Protected work stays hidden until the workspace, session, and any incoming link target are revalidated.
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}> 
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl onRefresh={() => void workfeed.reload()} refreshing={workfeed.phase === 'loading'} tintColor={colors.primary} />}
      >
        <View style={styles.headerBlock}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>MF10 visible workfeed</Text>
          <Text style={[styles.title, { color: colors.text }]}>My Work</Text>
          <Text style={[styles.body, { color: colors.text }]}>
            Assigned-work first, due-aware, and visibility-safe from the first paint.
          </Text>
        </View>

        <View style={styles.chipRow}>
          <View style={[styles.chip, { borderColor: colors.border }]}>
            <Text style={[styles.chipText, { color: colors.text }]}>
              Visible {workfeed.counts.totalVisibleTasks}
            </Text>
          </View>
          <View style={[styles.chip, { borderColor: colors.border }]}>
            <Text style={[styles.chipText, { color: colors.text }]}>Due now {workfeed.counts.dueNow}</Text>
          </View>
          <View style={[styles.chip, { borderColor: colors.border }]}>
            <Text style={[styles.chipText, { color: colors.text }]}>Overdue {workfeed.counts.overdue}</Text>
          </View>
          <View style={[styles.chip, { borderColor: colors.border }]}>
            <Text style={[styles.chipText, { color: colors.text }]}>Workspace {workfeed.workspaceId ?? '—'}</Text>
          </View>
        </View>

        {cacheBanner ? (
          <View style={[styles.banner, { borderColor: colors.primary, backgroundColor: `${colors.primary}14` }]}> 
            <Text style={[styles.bannerTitle, { color: colors.primary }]}>{cacheBanner.title}</Text>
            <Text style={[styles.bannerBody, { color: colors.text }]}>{cacheBanner.body}</Text>
            <View style={styles.bannerActions}>
              <Pressable onPress={() => void workfeed.reload()} style={[styles.bannerButton, { borderColor: colors.primary }]}> 
                <Text style={[styles.bannerButtonText, { color: colors.primary }]}>Retry live check</Text>
              </Pressable>
            </View>
          </View>
        ) : workfeed.landing.status === 'unavailable' ? (
          <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.card }]}> 
            <Text style={[styles.bannerTitle, { color: colors.primary }]}>Task unavailable</Text>
            <Text style={[styles.bannerBody, { color: colors.text }]}>That link does not resolve to visible work for the current caller, so the home surface stays safely generic.</Text>
          </View>
        ) : null}

        {workfeed.phase === 'error' && !cacheBanner ? (
          <View style={[styles.banner, { borderColor: colors.border, backgroundColor: colors.card }]}> 
            <Text style={[styles.bannerTitle, { color: colors.primary }]}>Couldn’t refresh</Text>
            <Text style={[styles.bannerBody, { color: colors.text }]}>{workfeed.errorMessage ?? 'Unable to load visible work.'}</Text>
            <View style={styles.bannerActions}>
              <Pressable onPress={() => void workfeed.reload()} style={[styles.bannerButton, { borderColor: colors.border }]}> 
                <Text style={[styles.bannerButtonText, { color: colors.text }]}>Retry</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {workfeed.phase === 'empty' ? (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}> 
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing visible right now</Text>
            <Text style={[styles.emptyBody, { color: colors.text }]}>When work becomes visible for this caller, it will appear here and in the due sections below.</Text>
          </View>
        ) : null}

        {workfeed.phase !== 'empty' ? (
          <>
            <View style={styles.surfaceBlock}>
              <View style={styles.surfaceHeader}>
                <Text style={[styles.surfaceTitle, { color: colors.text }]}>Visible work</Text>
                <Text style={[styles.surfaceNote, { color: colors.text }]}>Source: {workfeed.source}</Text>
              </View>
              <SectionBlock colors={colors} onTaskPress={openTask} sections={workfeed.myWork.sections} />
            </View>

            <View style={styles.surfaceBlock}>
              <View style={styles.surfaceHeader}>
                <Text style={[styles.surfaceTitle, { color: colors.text }]}>Due work</Text>
                <Text style={[styles.surfaceNote, { color: colors.text }]}>Today + overdue only from visible cards</Text>
              </View>
              <SectionBlock colors={colors} onTaskPress={openTask} sections={workfeed.due.sections} />
            </View>
          </>
        ) : null}

        <View style={styles.footerRow}>
          <Pressable onPress={() => void controller.logout()} style={[styles.secondaryButton, { borderColor: colors.border }]}> 
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  banner: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
  },
  bannerBody: {
    fontSize: 14,
    lineHeight: 22,
  },
  bannerActions: {
    marginTop: 4,
  },
  bannerButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bannerButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  cardList: {
    gap: 12,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  bodyBlock: {
    gap: 12,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 22,
  },
  emptyState: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  footerRow: {
    marginHorizontal: 16,
    marginTop: 24,
  },
  headerBlock: {
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
  },
  neutralBody: {
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  neutralShell: {
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 1,
    gap: 12,
    margin: 16,
    padding: 24,
  },
  neutralTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  sectionBlock: {
    gap: 12,
  },
  sectionCount: {
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  surfaceBlock: {
    gap: 16,
    marginHorizontal: 16,
    marginTop: 24,
  },
  surfaceHeader: {
    gap: 4,
  },
  surfaceNote: {
    fontSize: 13,
    opacity: 0.8,
  },
  surfaceTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  taskCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  taskCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  taskMeta: {
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.8,
  },
  taskStatus: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  taskTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
  },
})