import { describe, expect, it } from 'vitest';
import { applyOutline } from '../src/core/agent';
import { choose, questionsOf } from '../src/core/choice';
import { freshBoard } from '../src/core/model';

describe('questionnaire mode: the questions of a board', () => {
  it('lists every question in frame order with its options and which is on; answering changes it', () => {
    const b = freshBoard();
    applyOutline(b, 1, 'choose Who? | teams | leaders | *not sure', 'replace');
    b.frames.push({ ...b.frames[0], id: 'f2', caption: 'second', shapes: [], notes: [] });
    applyOutline(b, 2, 'text intro\nchoose Speed? | fast | *don\'t care\nchoose Size? | 1 TB | *don\'t care', 'replace');
    const qs = questionsOf(b);
    expect(qs.map((q) => [q.fi, q.q])).toEqual([[0, 'Who?'], [1, 'Speed?'], [1, 'Size?']]);
    expect(qs[0].options.map((o) => [o.opt, o.on])).toEqual([['teams', false], ['leaders', false], ['not sure', true]]);
    choose(b, 1, qs[1].options[0].idx, 'person');
    expect(questionsOf(b)[1].options.find((o) => o.on)?.opt).toBe('fast');
    expect(questionsOf(b)[2].options.find((o) => o.on)?.opt).toBe("don't care");
  });
});
