import FriendRequest from "../models/friendRequest.model.js";
import User from "../models/user.model.js";
import { getReceiverSocketId, io } from "../lib/socket.js";


export const searchUsers = async (req, res) => {
    const q = req.query.query?.trim();
    if (!q) return res.json([]);

    const regex = new RegExp(q, 'i');

    // Fetch your friends, outgoing (pending), outgoing (rejected), and incoming requests in parallel
    const [me, myOutgoing, myRejected, myIncoming] = await Promise.all([
        User.findById(req.user._id).select('friends').lean(),
        FriendRequest.find({
            sender: req.user._id,
            status: 'pending'
        }).select('receiver').lean(),
        FriendRequest.find({
            sender: req.user._id,
            status: 'rejected'
        }).select('receiver').lean(),
        FriendRequest.find({
            receiver: req.user._id,
            status: 'pending'
        }).select('sender').lean()
    ]);

    if (!me) {
        return res.status(404).json({ error: "User not found" });
    }

    // Build arrays of string IDs
    const friendIds = (me.friends || []).map(id => id.toString());
    const requestedIds = myOutgoing.map(r => r.receiver.toString());
    const rejectedIds = myRejected.map(r => r.receiver.toString());
    const incomingIds = myIncoming.map(r => r.sender.toString());

    // Exclude yourself, friends, outgoing requests, rejected requests, and incoming requests
    const excludeIds = [
        req.user._id.toString(),
        ...friendIds,
        ...requestedIds,
        ...rejectedIds,
        ...incomingIds
    ];

    const users = await User.find({
        _id: { $nin: excludeIds },
        $or: [{ fullName: regex }, { email: regex }]
    })
        .select('-password')
        .lean();

    res.json(users);
};

export const sendFriendRequest = async (req, res) => {
    const sender = req.user._id;
    const receiver = req.params.targetId;

    if (sender.equals(receiver)) return res.status(400).json({ error: "Cannot add yourself" });

    const alreadyFriends = await User.exists({ _id: sender, friends: receiver });
    if (alreadyFriends) return res.status(400).json({ error: "Already friends" });

    const request = await FriendRequest.findOneAndUpdate(
        { sender, receiver },
        {},                                   // nothing to change
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const sock = getReceiverSocketId(receiver);
    if (sock) io.to(sock).emit("friendRequest:new", request);

    res.status(201).json(request);
};

export const getIncomingRequests = async (req, res) => {
    const requests = await FriendRequest
        .find({ receiver: req.user._id, status: "pending" })
        .populate("sender", "-password");       // include sender info
    res.json(requests);
};

export const getOutgoingRequests = async (req, res) => {
    const requests = await FriendRequest
        .find({ sender: req.user._id, status: "pending" })
        .populate("receiver", "-password");
    res.json(requests);
};

export const respondToRequest = async (req, res) => {
    const { id } = req.params;          // FriendRequest _id
    const { action } = req.body;          // "accept" | "reject"

    const request = await FriendRequest.findById(id);
    if (!request || !request.receiver.equals(req.user._id) || request.status !== "pending")
        return res.status(404).json({ error: "Request not found" });

    if (action === "accept") {
        request.status = "accepted";
        await request.save();

        /* Add each user to the other's friends[] array */
        await User.updateOne({ _id: request.sender }, { $addToSet: { friends: request.receiver } });
        await User.updateOne({ _id: request.receiver }, { $addToSet: { friends: request.sender } });

        /* Notify both parties */
        [request.sender, request.receiver].forEach(uid => {
            const sock = getReceiverSocketId(uid);
            if (sock) io.to(sock).emit("friendRequest:accepted", { by: request.receiver });
        });
    } else {
        request.status = "rejected";
        await request.save();
    }

    res.json(request);
};

export const listFriends = async (req, res) => {
    const user = await User.findById(req.user._id)
        .populate("friends", "-password");
    res.json(user.friends);
};