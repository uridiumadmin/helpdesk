using System;
using System.Threading;
using System.Threading.Tasks;
using System.Threading.Channels;
using RabitMQCommunication.Model;

namespace RabitMQCommunication.QueueComm
{
    public class DrainDispatcher
    {
        private readonly IInbox _inbox;
        private readonly IAckQueue _ackQueue;
        private readonly IMessageHandler _handler;
        private readonly QueueOptions _options;
        private readonly Func<MessageEnvelope, string> _extractKey;
        private readonly SpscInbox[] _lanes;
        private readonly Task[] _workers;

        public DrainDispatcher(IInbox inbox, IAckQueue ackQueue, IMessageHandler handler, QueueOptions options, Func<MessageEnvelope, string> extractKey)
        {
            _inbox = inbox;
            _ackQueue = ackQueue;
            _handler = handler;
            _options = options;
            _extractKey = extractKey;

            var laneCount = Math.Max(1, _options.MaxParallelDrainers);
            _lanes = new SpscInbox[laneCount];
            _workers = new Task[laneCount];
            for (int i = 0; i < laneCount; i++)
            {
                var laneInbox = new SpscInbox();
                _lanes[i] = laneInbox;
                _workers[i] = Task.Run(() => WorkerLoopAsync(laneInbox));
            }
        }

        public async Task RunAsync(CancellationToken cancellationToken = default)
        {
            var laneCount = _lanes.Length;
            while (await _inbox.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var msg = await _inbox.ReadAsync(cancellationToken).ConfigureAwait(false);
                var key = _extractKey(msg) ?? string.Empty;
                var laneIdx = (key.GetHashCode() & int.MaxValue) % laneCount;
                await _lanes[laneIdx].WriteAsync(msg, cancellationToken).ConfigureAwait(false);
            }
        }

        private async Task WorkerLoopAsync(SpscInbox inbox)
        {
            while (await inbox.WaitToReadAsync(CancellationToken.None).ConfigureAwait(false))
            {
                var msg = await inbox.ReadAsync(CancellationToken.None).ConfigureAwait(false);
                var result = await _handler.HandleAsync(msg, CancellationToken.None).ConfigureAwait(false);
                var command = MapToAck(result);
                await _ackQueue.WriteAsync(command, CancellationToken.None).ConfigureAwait(false);
            }
        }

        private static AckCommand MapToAck(HandlerResult result)
        {
            return result switch
            {
                HandlerResult.Success => AckCommand.Ack,
                HandlerResult.Retry => AckCommand.Retry,
                _ => AckCommand.DeadLetter,
            };
        }

        public async Task Stop()
        {
            foreach (var lane in _lanes)
            {
                lane.Complete();
            }
            await Task.WhenAll(_workers).ConfigureAwait(false);
        }

        public Task Complete() => Stop();
    }

    public interface IInbox
    {
        ValueTask<bool> WaitToReadAsync(CancellationToken cancellationToken);
        ValueTask<MessageEnvelope> ReadAsync(CancellationToken cancellationToken);
        ValueTask WriteAsync(MessageEnvelope message, CancellationToken cancellationToken);
        void Complete();
    }

    public interface IAckQueue
    {
        ValueTask WriteAsync(AckCommand command, CancellationToken cancellationToken);
    }

    public interface IMessageHandler
    {
        ValueTask<HandlerResult> HandleAsync(MessageEnvelope message, CancellationToken cancellationToken);
    }

    public class QueueOptions
    {
        public int MaxParallelDrainers { get; set; } = 1;
    }

    public enum HandlerResult
    {
        Success,
        Retry,
        Fail
    }

    public enum AckCommand
    {
        Ack,
        Retry,
        DeadLetter
    }

    public class SpscInbox : IInbox
    {
        private readonly Channel<MessageEnvelope> _channel = Channel.CreateUnbounded<MessageEnvelope>();

        public ValueTask<bool> WaitToReadAsync(CancellationToken cancellationToken) => _channel.Reader.WaitToReadAsync(cancellationToken);

        public ValueTask<MessageEnvelope> ReadAsync(CancellationToken cancellationToken) => _channel.Reader.ReadAsync(cancellationToken);

        public ValueTask WriteAsync(MessageEnvelope message, CancellationToken cancellationToken) => _channel.Writer.WriteAsync(message, cancellationToken);

        public void Complete() => _channel.Writer.TryComplete();
    }
}

