import type BigInt from 'big-integer';
import { Api as GramJs } from '../../../lib/gramjs';
import type {
  ApiChat,
  ApiChatAdminRights,
  ApiChatBannedRights,
  ApiBotCommand,
  ApiChatFolder,
  ApiChatMember,
  ApiRestrictionReason,
  ApiExportedInvite,
  ApiChatInviteImporter,
  ApiChatSettings,
  ApiSendAsPeerId,
} from '../../types';
import { pick, pickTruthy } from '../../../util/iteratees';
import {
  buildApiPeerId, getApiChatIdFromMtpPeer, isPeerChat, isPeerUser,
} from './peers';
import { omitVirtualClassFields } from './helpers';
import { getServerTime } from '../../../util/serverTime';
import { buildApiReaction } from './messages';

type PeerEntityApiChatFields = Omit<ApiChat, (
  'id' | 'type' | 'title' |
  'lastReadOutboxMessageId' | 'lastReadInboxMessageId' |
  'unreadCount' | 'unreadMentionsCount' | 'isMuted'
)>;

function buildApiChatFieldsFromPeerEntity(
  peerEntity: GramJs.TypeUser | GramJs.TypeChat,
  isSupport = false,
): PeerEntityApiChatFields {
  const isMin = Boolean('min' in peerEntity && peerEntity.min);
  const accessHash = ('accessHash' in peerEntity) && String(peerEntity.accessHash);
  const hasVideoAvatar = 'photo' in peerEntity && peerEntity.photo && 'hasVideo' in peerEntity.photo
    && peerEntity.photo.hasVideo;
  const avatarHash = ('photo' in peerEntity) && peerEntity.photo && buildAvatarHash(peerEntity.photo);
  const isSignaturesShown = Boolean('signatures' in peerEntity && peerEntity.signatures);
  const hasPrivateLink = Boolean('hasLink' in peerEntity && peerEntity.hasLink);
  const isScam = Boolean('scam' in peerEntity && peerEntity.scam);
  const isFake = Boolean('fake' in peerEntity && peerEntity.fake);
  const isJoinToSend = Boolean('joinToSend' in peerEntity && peerEntity.joinToSend);
  const isJoinRequest = Boolean('joinRequest' in peerEntity && peerEntity.joinRequest);

  return {
    isMin,
    hasPrivateLink,
    isSignaturesShown,
    ...(accessHash && { accessHash }),
    hasVideoAvatar,
    ...(avatarHash && { avatarHash }),
    ...('username' in peerEntity && { username: peerEntity.username }),
    ...('verified' in peerEntity && { isVerified: peerEntity.verified }),
    ...('callActive' in peerEntity && { isCallActive: peerEntity.callActive }),
    ...('callNotEmpty' in peerEntity && { isCallNotEmpty: peerEntity.callNotEmpty }),
    ...('date' in peerEntity && { joinDate: peerEntity.date }),
    ...('participantsCount' in peerEntity && peerEntity.participantsCount !== undefined && {
      membersCount: peerEntity.participantsCount,
    }),
    ...('noforwards' in peerEntity && { isProtected: Boolean(peerEntity.noforwards) }),
    ...(isSupport && { isSupport: true }),
    ...buildApiChatPermissions(peerEntity),
    ...('creator' in peerEntity && { isCreator: peerEntity.creator }),
    ...buildApiChatRestrictions(peerEntity),
    ...buildApiChatMigrationInfo(peerEntity),
    fakeType: isScam ? 'scam' : (isFake ? 'fake' : undefined),
    isJoinToSend,
    isJoinRequest,
  };
}

export function buildApiChatFromDialog(
  dialog: GramJs.Dialog,
  peerEntity: GramJs.TypeUser | GramJs.TypeChat,
  serverTimeOffset: number,
): ApiChat {
  const {
    peer, folderId, unreadMark, unreadCount, unreadMentionsCount, unreadReactionsCount,
    notifySettings: { silent, muteUntil },
    readOutboxMaxId, readInboxMaxId, draft,
  } = dialog;
  const isMuted = silent || (typeof muteUntil === 'number' && getServerTime(serverTimeOffset) < muteUntil);

  return {
    id: getApiChatIdFromMtpPeer(peer),
    ...(folderId && { folderId }),
    type: getApiChatTypeFromPeerEntity(peerEntity),
    title: getApiChatTitleFromMtpPeer(peer, peerEntity),
    lastReadOutboxMessageId: readOutboxMaxId,
    lastReadInboxMessageId: readInboxMaxId,
    unreadCount,
    unreadMentionsCount,
    unreadReactionsCount,
    isMuted,
    ...(unreadMark && { hasUnreadMark: true }),
    ...(draft instanceof GramJs.DraftMessage && { draftDate: draft.date }),
    ...buildApiChatFieldsFromPeerEntity(peerEntity),
  };
}

function buildApiChatPermissions(peerEntity: GramJs.TypeUser | GramJs.TypeChat): {
  adminRights?: ApiChatAdminRights;
  currentUserBannedRights?: ApiChatBannedRights;
  defaultBannedRights?: ApiChatBannedRights;
} {
  if (!(peerEntity instanceof GramJs.Chat || peerEntity instanceof GramJs.Channel)) {
    return {};
  }

  return {
    adminRights: peerEntity.adminRights ? omitVirtualClassFields(peerEntity.adminRights) : undefined,
    currentUserBannedRights: 'bannedRights' in peerEntity && peerEntity.bannedRights
      ? omitVirtualClassFields(peerEntity.bannedRights)
      : undefined,
    defaultBannedRights: peerEntity.defaultBannedRights
      ? omitVirtualClassFields(peerEntity.defaultBannedRights)
      : undefined,
  };
}

function buildApiChatRestrictions(peerEntity: GramJs.TypeUser | GramJs.TypeChat): {
  isNotJoined?: boolean;
  isForbidden?: boolean;
  isRestricted?: boolean;
  restrictionReason?: ApiRestrictionReason;
} {
  if (peerEntity instanceof GramJs.ChatForbidden) {
    return {
      isForbidden: true,
    };
  }

  if (peerEntity instanceof GramJs.ChannelForbidden) {
    return {
      isRestricted: true,
    };
  }

  const restrictions = {};

  if ('restricted' in peerEntity) {
    const restrictionReason = peerEntity.restricted
      ? buildApiChatRestrictionReason(peerEntity.restrictionReason)
      : undefined;

    if (restrictionReason) {
      Object.assign(restrictions, {
        isRestricted: true,
        restrictionReason,
      });
    }
  }

  if (peerEntity instanceof GramJs.Chat) {
    Object.assign(restrictions, {
      isNotJoined: peerEntity.left,
    });
  }

  if (peerEntity instanceof GramJs.Channel) {
    Object.assign(restrictions, {
      // `left` is weirdly set to `true` on all channels never joined before
      isNotJoined: peerEntity.left,
    });
  }

  return restrictions;
}

function buildApiChatMigrationInfo(peerEntity: GramJs.TypeChat): {
  migratedTo?: {
    chatId: string;
    accessHash?: string;
  };
} {
  if (
    'migratedTo' in peerEntity
    && peerEntity.migratedTo
    && !(peerEntity.migratedTo instanceof GramJs.InputChannelEmpty)
  ) {
    return {
      migratedTo: {
        chatId: getApiChatIdFromMtpPeer(peerEntity.migratedTo),
        ...(peerEntity.migratedTo instanceof GramJs.InputChannel && {
          accessHash: String(peerEntity.migratedTo.accessHash),
        }),
      },
    };
  }

  return {};
}

function buildApiChatRestrictionReason(
  restrictionReasons?: GramJs.RestrictionReason[],
): ApiRestrictionReason | undefined {
  if (!restrictionReasons) {
    return undefined;
  }

  const targetReason = restrictionReasons.find(({ platform }) => platform === 'all');
  return targetReason ? pick(targetReason, ['reason', 'text']) : undefined;
}

export function buildApiChatFromPreview(
  preview: GramJs.TypeChat | GramJs.TypeUser,
  isSupport = false,
): ApiChat | undefined {
  if (preview instanceof GramJs.ChatEmpty || preview instanceof GramJs.UserEmpty) {
    return undefined;
  }

  return {
    id: buildApiPeerId(preview.id, preview instanceof GramJs.User ? 'user' : 'chat'),
    type: getApiChatTypeFromPeerEntity(preview),
    title: preview instanceof GramJs.User ? getUserName(preview) : preview.title,
    ...buildApiChatFieldsFromPeerEntity(preview, isSupport),
  };
}

export function getApiChatTypeFromPeerEntity(peerEntity: GramJs.TypeChat | GramJs.TypeUser) {
  if (peerEntity instanceof GramJs.User || peerEntity instanceof GramJs.UserEmpty) {
    return 'chatTypePrivate';
  } else if (
    peerEntity instanceof GramJs.Chat
    || peerEntity instanceof GramJs.ChatForbidden
    || peerEntity instanceof GramJs.ChatEmpty
  ) {
    return 'chatTypeBasicGroup';
  } else {
    return peerEntity.megagroup ? 'chatTypeSuperGroup' : 'chatTypeChannel';
  }
}

export function getPeerKey(peer: GramJs.TypePeer) {
  if (isPeerUser(peer)) {
    return `user${peer.userId}`;
  } else if (isPeerChat(peer)) {
    return `chat${peer.chatId}`;
  } else {
    return `chat${peer.channelId}`;
  }
}

export function getApiChatTitleFromMtpPeer(peer: GramJs.TypePeer, peerEntity: GramJs.User | GramJs.Chat) {
  if (isPeerUser(peer)) {
    return getUserName(peerEntity as GramJs.User);
  } else {
    return (peerEntity as GramJs.Chat).title;
  }
}

function getUserName(user: GramJs.User) {
  return user.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : (user.lastName || undefined);
}

export function buildAvatarHash(photo: GramJs.TypeUserProfilePhoto | GramJs.TypeChatPhoto) {
  if ('photoId' in photo) {
    return String(photo.photoId);
  }

  return undefined;
}

export function buildChatMember(
  member: GramJs.TypeChatParticipant | GramJs.TypeChannelParticipant,
): ApiChatMember | undefined {
  const userId = (member instanceof GramJs.ChannelParticipantBanned || member instanceof GramJs.ChannelParticipantLeft)
    ? getApiChatIdFromMtpPeer(member.peer)
    : buildApiPeerId(member.userId, 'user');

  return {
    userId,
    inviterId: 'inviterId' in member ? buildApiPeerId(member.inviterId as BigInt.BigInteger, 'user') : undefined,
    joinedDate: 'date' in member ? member.date : undefined,
    kickedByUserId: 'kickedBy' in member ? buildApiPeerId(member.kickedBy, 'user') : undefined,
    promotedByUserId: 'promotedBy' in member ? buildApiPeerId(member.promotedBy, 'user') : undefined,
    bannedRights: 'bannedRights' in member ? omitVirtualClassFields(member.bannedRights) : undefined,
    adminRights: 'adminRights' in member ? omitVirtualClassFields(member.adminRights) : undefined,
    customTitle: 'rank' in member ? member.rank : undefined,
    ...((member instanceof GramJs.ChannelParticipantAdmin || member instanceof GramJs.ChatParticipantAdmin) && {
      isAdmin: true,
    }),
    ...((member instanceof GramJs.ChannelParticipantCreator || member instanceof GramJs.ChatParticipantCreator) && {
      isOwner: true,
    }),
  };
}

export function buildChatMembers(
  participants: GramJs.TypeChatParticipants | GramJs.channels.ChannelParticipants,
) {
  // Duplicate code because of TS union-type shenanigans
  if (participants instanceof GramJs.ChatParticipants) {
    return participants.participants.map(buildChatMember).filter(Boolean);
  }
  if (participants instanceof GramJs.channels.ChannelParticipants) {
    return participants.participants.map(buildChatMember).filter(Boolean);
  }

  return undefined;
}

export function buildChatTypingStatus(
  update: GramJs.UpdateUserTyping | GramJs.UpdateChatUserTyping | GramJs.UpdateChannelUserTyping,
  serverTimeOffset: number,
) {
  let action: string = '';
  let emoticon: string | undefined;
  if (update.action instanceof GramJs.SendMessageCancelAction) {
    return undefined;
  } else if (update.action instanceof GramJs.SendMessageTypingAction) {
    action = 'lng_user_typing';
  } else if (update.action instanceof GramJs.SendMessageRecordVideoAction) {
    action = 'lng_send_action_record_video';
  } else if (update.action instanceof GramJs.SendMessageUploadVideoAction) {
    action = 'lng_send_action_upload_video';
  } else if (update.action instanceof GramJs.SendMessageRecordAudioAction) {
    action = 'lng_send_action_record_audio';
  } else if (update.action instanceof GramJs.SendMessageUploadAudioAction) {
    action = 'lng_send_action_upload_audio';
  } else if (update.action instanceof GramJs.SendMessageUploadPhotoAction) {
    action = 'lng_send_action_upload_photo';
  } else if (update.action instanceof GramJs.SendMessageUploadDocumentAction) {
    action = 'lng_send_action_upload_file';
  } else if (update.action instanceof GramJs.SendMessageGeoLocationAction) {
    action = 'selecting a location to share';
  } else if (update.action instanceof GramJs.SendMessageChooseContactAction) {
    action = 'selecting a contact to share';
  } else if (update.action instanceof GramJs.SendMessageGamePlayAction) {
    action = 'lng_playing_game';
  } else if (update.action instanceof GramJs.SendMessageRecordRoundAction) {
    action = 'lng_send_action_record_round';
  } else if (update.action instanceof GramJs.SendMessageUploadRoundAction) {
    action = 'lng_send_action_upload_round';
  } else if (update.action instanceof GramJs.SendMessageChooseStickerAction) {
    action = 'lng_send_action_choose_sticker';
  } else if (update.action instanceof GramJs.SpeakingInGroupCallAction) {
    return undefined;
  } else if (update.action instanceof GramJs.SendMessageEmojiInteractionSeen) {
    action = 'lng_user_action_watching_animations';
    emoticon = update.action.emoticon;
  } else if (update.action instanceof GramJs.SendMessageEmojiInteraction) {
    return undefined;
  }

  return {
    action,
    ...(emoticon && { emoji: emoticon }),
    ...(!(update instanceof GramJs.UpdateUserTyping) && { userId: getApiChatIdFromMtpPeer(update.fromId) }),
    timestamp: Date.now() + serverTimeOffset * 1000,
  };
}

export function buildApiChatFolder(filter: GramJs.DialogFilter): ApiChatFolder {
  return {
    ...pickTruthy(filter, [
      'id', 'title', 'emoticon', 'contacts', 'nonContacts', 'groups', 'bots',
      'excludeMuted', 'excludeRead', 'excludeArchived',
    ]),
    channels: filter.broadcasts,
    pinnedChatIds: filter.pinnedPeers.map(getApiChatIdFromMtpPeer).filter(Boolean),
    includedChatIds: filter.includePeers.map(getApiChatIdFromMtpPeer).filter(Boolean),
    excludedChatIds: filter.excludePeers.map(getApiChatIdFromMtpPeer).filter(Boolean),
  };
}

export function buildApiChatFolderFromSuggested({
  filter, description,
}: {
  filter: GramJs.TypeDialogFilter;
  description: string;
}): ApiChatFolder | undefined {
  if (!(filter instanceof GramJs.DialogFilter)) return undefined;
  return {
    ...buildApiChatFolder(filter),
    description,
  };
}

export function buildApiChatBotCommands(botInfos: GramJs.BotInfo[]) {
  return botInfos.reduce((botCommands, botInfo) => {
    const botId = buildApiPeerId(botInfo.userId!, 'user');

    if (botInfo.commands) {
      botCommands = botCommands.concat(botInfo.commands.map((mtpCommand) => ({
        botId,
        ...omitVirtualClassFields(mtpCommand),
      })));
    }

    return botCommands;
  }, [] as ApiBotCommand[]);
}

export function buildApiExportedInvite(invite: GramJs.ChatInviteExported): ApiExportedInvite {
  const {
    revoked,
    date,
    expireDate,
    link,
    permanent,
    startDate,
    usage,
    usageLimit,
    requested,
    requestNeeded,
    title,
    adminId,
  } = invite;
  return {
    isRevoked: revoked,
    date,
    expireDate,
    link,
    isPermanent: permanent,
    startDate,
    usage,
    usageLimit,
    isRequestNeeded: requestNeeded,
    requested,
    title,
    adminId: buildApiPeerId(adminId, 'user'),
  };
}

export function buildChatInviteImporter(importer: GramJs.ChatInviteImporter): ApiChatInviteImporter {
  const {
    userId,
    date,
    about,
    requested,
  } = importer;
  return {
    userId: buildApiPeerId(userId, 'user'),
    date,
    about,
    isRequested: requested,
  };
}

export function buildApiChatSettings({
  autoarchived,
  reportSpam,
  addContact,
  blockContact,
}: GramJs.PeerSettings): ApiChatSettings {
  return {
    isAutoArchived: Boolean(autoarchived),
    canReportSpam: Boolean(reportSpam),
    canAddContact: Boolean(addContact),
    canBlockContact: Boolean(blockContact),
  };
}

export function buildApiChatReactions(availableReactions?: GramJs.TypeChatReactions): string[] | undefined {
  if (availableReactions instanceof GramJs.ChatReactionsAll) {
    // TODO Hack before custom reactions are implemented
    // eslint-disable-next-line max-len
    return ['👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡', '🥱', '🥴', '😍', '🐳', '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈'];
  }
  if (availableReactions instanceof GramJs.ChatReactionsSome) {
    return availableReactions.reactions.map(buildApiReaction).filter(Boolean);
  }

  return undefined;
}

export function buildApiSendAsPeerId(sendAs: GramJs.SendAsPeer): ApiSendAsPeerId {
  return {
    id: getApiChatIdFromMtpPeer(sendAs.peer),
    isPremium: sendAs.premiumRequired,
  };
}
