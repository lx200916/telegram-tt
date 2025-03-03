import type { FC } from '../../../lib/teact/teact';
import React, {
  memo, useCallback, useLayoutEffect, useMemo, useRef,
} from '../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../global';

import type { LangFn } from '../../../hooks/useLang';
import type { ObserveFn } from '../../../hooks/useIntersectionObserver';
import type {
  ApiChat, ApiUser, ApiMessage, ApiMessageOutgoingStatus, ApiFormattedText, ApiUserStatus,
} from '../../../api/types';
import type { AnimationLevel } from '../../../types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { ANIMATION_END_DELAY } from '../../../config';
import { IS_SINGLE_COLUMN_LAYOUT } from '../../../util/environment';
import {
  isUserId,
  isActionMessage,
  getPrivateChatUserId,
  getMessageAction,
  getMessageSenderName,
  isChatChannel,
  getMessageMediaHash,
  getMessageMediaThumbDataUri,
  getMessageVideo,
  getMessageSticker,
  selectIsChatMuted,
  getMessageRoundVideo,
} from '../../../global/helpers';
import {
  selectChat, selectUser, selectChatMessage, selectOutgoingStatus, selectDraft, selectCurrentMessageList,
  selectNotifySettings, selectNotifyExceptions, selectUserStatus, selectIsDefaultEmojiStatusPack,
} from '../../../global/selectors';
import { renderActionMessageText } from '../../common/helpers/renderActionMessageText';
import renderText from '../../common/helpers/renderText';
import { renderTextWithEntities } from '../../common/helpers/renderTextWithEntities';
import { fastRaf } from '../../../util/schedulers';
import buildClassName from '../../../util/buildClassName';
import { renderMessageSummary } from '../../common/helpers/renderMessageText';

import useEnsureMessage from '../../../hooks/useEnsureMessage';
import useChatContextActions from '../../../hooks/useChatContextActions';
import useFlag from '../../../hooks/useFlag';
import useMedia from '../../../hooks/useMedia';
import { ChatAnimationTypes } from './hooks';
import useLang from '../../../hooks/useLang';

import Avatar from '../../common/Avatar';
import TypingStatus from '../../common/TypingStatus';
import LastMessageMeta from '../../common/LastMessageMeta';
import DeleteChatModal from '../../common/DeleteChatModal';
import ListItem from '../../ui/ListItem';
import Badge from './Badge';
import ChatFolderModal from '../ChatFolderModal.async';
import ChatCallStatus from './ChatCallStatus';
import ReportModal from '../../common/ReportModal';
import FullNameTitle from '../../common/FullNameTitle';

import './Chat.scss';

type OwnProps = {
  style?: string;
  chatId: string;
  folderId?: number;
  orderDiff: number;
  animationType: ChatAnimationTypes;
  isPinned?: boolean;
  observeIntersection?: ObserveFn;
  onDragEnter?: (chatId: string) => void;
};

type StateProps = {
  chat?: ApiChat;
  isMuted?: boolean;
  user?: ApiUser;
  userStatus?: ApiUserStatus;
  isEmojiStatusColored?: boolean;
  actionTargetUserIds?: string[];
  actionTargetMessage?: ApiMessage;
  actionTargetChatId?: string;
  lastMessageSender?: ApiUser;
  lastMessageOutgoingStatus?: ApiMessageOutgoingStatus;
  draft?: ApiFormattedText;
  animationLevel?: AnimationLevel;
  isSelected?: boolean;
  canScrollDown?: boolean;
  canChangeFolder?: boolean;
  lastSyncTime?: number;
};

const ANIMATION_DURATION = 200;

const Chat: FC<OwnProps & StateProps> = ({
  style,
  chatId,
  folderId,
  orderDiff,
  animationType,
  isPinned,
  observeIntersection,
  chat,
  isMuted,
  user,
  userStatus,
  isEmojiStatusColored,
  actionTargetUserIds,
  lastMessageSender,
  lastMessageOutgoingStatus,
  actionTargetMessage,
  actionTargetChatId,
  draft,
  animationLevel,
  isSelected,
  canScrollDown,
  canChangeFolder,
  lastSyncTime,
  onDragEnter,
}) => {
  const {
    openChat,
    focusLastMessage,
  } = getActions();

  // eslint-disable-next-line no-null/no-null
  const ref = useRef<HTMLDivElement>(null);

  const [isDeleteModalOpen, openDeleteModal, closeDeleteModal] = useFlag();
  const [isChatFolderModalOpen, openChatFolderModal, closeChatFolderModal] = useFlag();
  const [isReportModalOpen, openReportModal, closeReportModal] = useFlag();
  const [shouldRenderDeleteModal, markRenderDeleteModal, unmarkRenderDeleteModal] = useFlag();
  const [shouldRenderChatFolderModal, markRenderChatFolderModal, unmarkRenderChatFolderModal] = useFlag();
  const [shouldRenderReportModal, markRenderReportModal, unmarkRenderReportModal] = useFlag();

  const { lastMessage, typingStatus } = chat || {};
  const isAction = lastMessage && isActionMessage(lastMessage);

  useEnsureMessage(chatId, isAction ? lastMessage.replyToMessageId : undefined, actionTargetMessage);

  const mediaThumbnail = lastMessage && !getMessageSticker(lastMessage)
    ? getMessageMediaThumbDataUri(lastMessage)
    : undefined;
  const mediaBlobUrl = useMedia(lastMessage ? getMessageMediaHash(lastMessage, 'micro') : undefined);
  const isRoundVideo = Boolean(lastMessage && getMessageRoundVideo(lastMessage));

  const actionTargetUsers = useMemo(() => {
    if (!actionTargetUserIds) {
      return undefined;
    }

    // No need for expensive global updates on users, so we avoid them
    const usersById = getGlobal().users.byId;
    return actionTargetUserIds.map((userId) => usersById[userId]).filter(Boolean);
  }, [actionTargetUserIds]);

  // Sets animation excess values when `orderDiff` changes and then resets excess values to animate.
  useLayoutEffect(() => {
    const element = ref.current;

    if (animationLevel === 0 || !element) {
      return;
    }

    // TODO Refactor animation: create `useListAnimation` that owns `orderDiff` and `animationType`
    if (animationType === ChatAnimationTypes.Opacity) {
      element.style.opacity = '0';

      fastRaf(() => {
        element.classList.add('animate-opacity');
        element.style.opacity = '1';
      });
    } else if (animationType === ChatAnimationTypes.Move) {
      element.style.transform = `translate3d(0, ${-orderDiff * 100}%, 0)`;

      fastRaf(() => {
        element.classList.add('animate-transform');
        element.style.transform = '';
      });
    } else {
      return;
    }

    setTimeout(() => {
      fastRaf(() => {
        element.classList.remove('animate-opacity', 'animate-transform');
        element.style.opacity = '';
        element.style.transform = '';
      });
    }, ANIMATION_DURATION + ANIMATION_END_DELAY);
  }, [animationLevel, orderDiff, animationType]);

  const handleClick = useCallback(() => {
    openChat({ id: chatId, shouldReplaceHistory: true }, { forceOnHeavyAnimation: true });

    if (isSelected && canScrollDown) {
      focusLastMessage();
    }
  }, [
    isSelected,
    canScrollDown,
    openChat,
    chatId,
    focusLastMessage,
  ]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    onDragEnter?.(chatId);
  }, [chatId, onDragEnter]);

  const handleDelete = useCallback(() => {
    markRenderDeleteModal();
    openDeleteModal();
  }, [markRenderDeleteModal, openDeleteModal]);

  const handleChatFolderChange = useCallback(() => {
    markRenderChatFolderModal();
    openChatFolderModal();
  }, [markRenderChatFolderModal, openChatFolderModal]);

  const handleReport = useCallback(() => {
    markRenderReportModal();
    openReportModal();
  }, [markRenderReportModal, openReportModal]);

  const contextActions = useChatContextActions({
    chat,
    user,
    handleDelete,
    handleChatFolderChange,
    handleReport,
    folderId,
    isPinned,
    isMuted,
    canChangeFolder,
  });

  const lang = useLang();

  if (!chat) {
    return undefined;
  }

  function renderLastMessageOrTyping() {
    if (typingStatus && lastMessage && typingStatus.timestamp > lastMessage.date * 1000) {
      return <TypingStatus typingStatus={typingStatus} />;
    }

    if (draft?.text.length) {
      return (
        <p className="last-message" dir={lang.isRtl ? 'auto' : 'ltr'}>
          <span className="draft">{lang('Draft')}</span>
          {renderTextWithEntities(draft.text, draft.entities, undefined, undefined, undefined, undefined, true)}
        </p>
      );
    }

    if (!lastMessage) {
      return undefined;
    }

    if (isAction) {
      const isChat = chat && (isChatChannel(chat) || lastMessage.senderId === lastMessage.chatId);

      return (
        <p className="last-message" dir={lang.isRtl ? 'auto' : 'ltr'}>
          {renderActionMessageText(
            lang,
            lastMessage,
            !isChat ? lastMessageSender : undefined,
            isChat ? chat : undefined,
            actionTargetUsers,
            actionTargetMessage,
            actionTargetChatId,
            { asTextWithSpoilers: true },
          )}
        </p>
      );
    }

    const senderName = getMessageSenderName(lang, chatId, lastMessageSender);

    return (
      <p className="last-message" dir={lang.isRtl ? 'auto' : 'ltr'}>
        {senderName && (
          <>
            <span className="sender-name">{renderText(senderName)}</span>
            <span className="colon">:</span>
          </>
        )}
        {renderSummary(lang, lastMessage, observeIntersection, mediaBlobUrl || mediaThumbnail, isRoundVideo)}
      </p>
    );
  }

  const className = buildClassName(
    'Chat chat-item-clickable',
    isUserId(chatId) ? 'private' : 'group',
    isSelected && 'selected',
  );

  return (
    <ListItem
      ref={ref}
      className={className}
      style={style}
      ripple={!IS_SINGLE_COLUMN_LAYOUT}
      contextActions={contextActions}
      onClick={handleClick}
      onDragEnter={handleDragEnter}
    >
      <div className="status">
        <Avatar
          chat={chat}
          user={user}
          userStatus={userStatus}
          isSavedMessages={user?.isSelf}
          lastSyncTime={lastSyncTime}
          animationLevel={animationLevel}
          withVideo
          observeIntersection={observeIntersection}
        />
        {chat.isCallActive && chat.isCallNotEmpty && (
          <ChatCallStatus isSelected={isSelected} isActive={animationLevel !== 0} />
        )}
      </div>
      <div className="info">
        <div className="info-row">
          <FullNameTitle
            peer={user || chat}
            withEmojiStatus
            isSavedMessages={chatId === user?.id && user?.isSelf}
            observeIntersection={observeIntersection}
            key={!IS_SINGLE_COLUMN_LAYOUT && isEmojiStatusColored ? `${isSelected}` : undefined}
          />
          {isMuted && <i className="icon-muted" />}
          <div className="separator" />
          {chat.lastMessage && (
            <LastMessageMeta
              message={chat.lastMessage}
              outgoingStatus={lastMessageOutgoingStatus}
            />
          )}
        </div>
        <div className="subtitle">
          {renderLastMessageOrTyping()}
          <Badge chat={chat} isPinned={isPinned} isMuted={isMuted} />
        </div>
      </div>
      {shouldRenderDeleteModal && (
        <DeleteChatModal
          isOpen={isDeleteModalOpen}
          onClose={closeDeleteModal}
          onCloseAnimationEnd={unmarkRenderDeleteModal}
          chat={chat}
        />
      )}
      {shouldRenderChatFolderModal && (
        <ChatFolderModal
          isOpen={isChatFolderModalOpen}
          onClose={closeChatFolderModal}
          onCloseAnimationEnd={unmarkRenderChatFolderModal}
          chatId={chatId}
        />
      )}
      {shouldRenderReportModal && (
        <ReportModal
          isOpen={isReportModalOpen}
          onClose={closeReportModal}
          onCloseAnimationEnd={unmarkRenderReportModal}
          chatId={chatId}
          subject="peer"
        />
      )}
    </ListItem>
  );
};

function renderSummary(
  lang: LangFn, message: ApiMessage, observeIntersection?: ObserveFn, blobUrl?: string, isRoundVideo?: boolean,
) {
  if (!blobUrl) {
    return renderMessageSummary(lang, message, undefined, undefined, undefined, observeIntersection);
  }

  return (
    <span className="media-preview">
      <img src={blobUrl} alt="" className={buildClassName('media-preview--image', isRoundVideo && 'round')} />
      {getMessageVideo(message) && <i className="icon-play" />}
      {renderMessageSummary(lang, message, true, undefined, undefined, observeIntersection)}
    </span>
  );
}

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): StateProps => {
    const chat = selectChat(global, chatId);
    if (!chat) {
      return {};
    }

    const { senderId, replyToMessageId, isOutgoing } = chat.lastMessage || {};
    const lastMessageSender = senderId ? selectUser(global, senderId) : undefined;
    const lastMessageAction = chat.lastMessage ? getMessageAction(chat.lastMessage) : undefined;
    const actionTargetMessage = lastMessageAction && replyToMessageId
      ? selectChatMessage(global, chat.id, replyToMessageId)
      : undefined;
    const { targetUserIds: actionTargetUserIds, targetChatId: actionTargetChatId } = lastMessageAction || {};
    const privateChatUserId = getPrivateChatUserId(chat);
    const {
      chatId: currentChatId,
      threadId: currentThreadId,
      type: messageListType,
    } = selectCurrentMessageList(global) || {};
    const isSelected = chatId === currentChatId && currentThreadId === MAIN_THREAD_ID;

    const user = privateChatUserId ? selectUser(global, privateChatUserId) : undefined;
    const userStatus = privateChatUserId ? selectUserStatus(global, privateChatUserId) : undefined;
    const statusEmoji = user?.emojiStatus && global.customEmojis.byId[user.emojiStatus.documentId];
    const isEmojiStatusColored = statusEmoji && selectIsDefaultEmojiStatusPack(global, statusEmoji.stickerSetInfo);

    return {
      chat,
      isMuted: selectIsChatMuted(chat, selectNotifySettings(global), selectNotifyExceptions(global)),
      lastMessageSender,
      actionTargetUserIds,
      actionTargetChatId,
      actionTargetMessage,
      draft: selectDraft(global, chatId, MAIN_THREAD_ID),
      animationLevel: global.settings.byKey.animationLevel,
      isSelected,
      canScrollDown: isSelected && messageListType === 'thread',
      canChangeFolder: (global.chatFolders.orderedIds?.length || 0) > 1,
      lastSyncTime: global.lastSyncTime,
      ...(isOutgoing && chat.lastMessage && {
        lastMessageOutgoingStatus: selectOutgoingStatus(global, chat.lastMessage),
      }),
      user,
      userStatus,
      isEmojiStatusColored,
    };
  },
)(Chat));
