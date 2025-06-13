import User from "../models/user.model.js";
import Message from "../models/message.model.js";

import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io } from "../lib/socket.js";

export const getUsersForSidebar = async (req, res) => {
  try {
    const myId = req.user._id;

    // ① Get my friends’ IDs
    const me = await User.findById(myId).select('friends').lean();
    const friendIds = me.friends;                      // [ObjectId]

    if (!friendIds.length) return res.json([]);

    /* ② Aggregate messages once – much faster than N× queries */
    const chats = await Message.aggregate([
      // only conversations that involve me + any friend
      {
        $match: {
          $or: [
            { senderId: myId, receiverId: { $in: friendIds } },
            { senderId: { $in: friendIds }, receiverId: myId }
          ]
        }
      },

      /* 2a. Work out "the other person" per message */
      {
        $addFields: {
          otherUser: {
            $cond: [
              { $eq: ['$senderId', myId] },
              '$receiverId',           // I sent it → the other is receiver
              '$senderId'              // I received it → the other is sender
            ]
          }
        }
      },

      /* 2b. Sort newest→oldest so `$first` below == latest message */
      { $sort: { createdAt: -1 } },

      /* 2c. Collapse all messages per friend */
      {
        $group: {
          _id: '$otherUser',
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiverId', myId] }, // sent TO me
                    { $eq: ['$read', false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },

      /* 2d. Join user profile data */
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },

      /* 2e. Shape the payload sent to the client */
      {
        $project: {
          _id: '$user._id',
          fullName: '$user.fullName',
          email: '$user.email',
          profilePic: '$user.profilePic',
          lastMessage: {
            text: '$lastMessage.text',
            image: '$lastMessage.image',
            audio: '$lastMessage.audio',
            at: '$lastMessage.createdAt',
            fromMe: { $eq: ['$lastMessage.senderId', myId] }
          },
          unreadCount: 1
        }
      },

      /* 2f. Sort by latest activity like WhatsApp */
      { $sort: { 'lastMessage.at': -1 } }
    ]);

    res.json(chats);
  } catch (err) {
    console.error('getUsersForSidebar:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};


export const getMessages = async (req, res) => {
  try {
    const { id: userToChatId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    });

    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { text, image, audio } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    const areFriends = await User.exists({ _id: senderId, friends: receiverId });
    if (!areFriends)
      return res.status(403).json({ error: "Can only message friends" });

    let imageUrl, audioUrl;
    if (image) {
      // Upload base64 image to cloudinary
      const uploadResponse = await cloudinary.uploader.upload(image);
      imageUrl = uploadResponse.secure_url;
    }
    if (audio) {
      // Cloudinary treats audio as `resource_type: 'video'`
      const upload = await cloudinary.uploader.upload(audio, {
        resource_type: 'video',   // <— important
        folder: 'voice-notes'
      });
      audioUrl = upload.secure_url;
    }

    const newMessage = new Message({
      senderId,
      receiverId,
      text,
      image: imageUrl,
      audio: audioUrl
    });

    await newMessage.save();

    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const clearUnreadCount = async (req, res) => {
  try {
    const myId = req.user._id;
    const { id: otherUserId } = req.params;

    // Mark all messages from otherUserId to me as read
    await Message.updateMany(
      { senderId: otherUserId, receiverId: myId, read: false },
      { $set: { read: true } }
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error in clearUnreadCount:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};